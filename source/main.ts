import express from 'express';
import {Express} from 'express-serve-static-core';
import {readdir, readFile, stat, writeFile} from 'node:fs/promises';
import {createReadStream, existsSync, Stats} from 'node:fs';
import {extname, join} from 'node:path';
import {once} from 'node:events';
import {Server} from 'http';
import {FileTypeResult, fromFile} from 'file-type';
import {Document, DOMParser, Element, XMLSerializer} from '@xmldom/xmldom';
import {ReadStream} from 'fs';
import {emitKeypressEvents} from 'node:readline';

// Remember the % operator is a remainder operator. NOT a modulo operator.
// To perform a modulo operation you need to do ((a % n ) + n ) % n
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Remainder
// Which we're adding here as an available function for any primitive number type for convenience
Number.prototype['modulo'] = function(divisor: number): number {
  // @ts-ignore
  return ((this % divisor) + divisor) % divisor;
};

const run = async () => {
  const knownExtensionsToIgnore: Set<string> = new Set([
    '.psd', '.ras', '.pcx',
    '.pnm', '.pbm', '.pgm',
    '.ppm', '.xbm', '.xpm',
    '.xcf',
  ]);
  let absPath: string = null;
  let lastImgIdx: number = -1;

  const expressApp: Express = express();
  expressApp.use(express.json());
  expressApp.use((req, res, next) => {
    // Remove CORS restrictions
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow any origin
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200); // Handle preflight requests
      return;
    }

    next();
  });

  // Endpoint lets the OBS Browser source tell the Photo Carousel App what directory to look at for images
  expressApp.post('/source', (req, res) => {
    req.setEncoding('utf8');
    const reqPayload: { absPath: string } = req.body;
    absPath = reqPayload.absPath;

    const dirIsValid: boolean = existsSync(absPath);
    if (!dirIsValid) {
      res.status(400).send('The folder path provided does not exist. Please review your settings.');
      return;
    }

    lastImgIdx = -1;
    res.sendStatus(200);
  });

  expressApp.get('/health', (_, res) => {
    res.sendStatus(200);
  });

  // Endpoint lets the OBS Browser source ask the PC for the next image from image directory
  expressApp.get('/next', async (_, res) => {
    if (!absPath?.length) {
      res.status(400).send('Image folder was not set.\nPlease review your settings.');
      return;
    }

    const allFilePaths: string[] = await (async () => {
      // Get the name of all items in the directory
      const allContentNames: string[] = await readdir(absPath);

      // For each item's name turn it into a full path. e.g. meme01.jpg -> /path/to/memes/meme01.jpg
      // And only keep directory items that are files. Ignore directory items that are directories.
      // const fileAbsPaths: Array<[string, string]> = await Promise.all(allContentNames.map(async name => {
      const fileAbsPaths: string[] = await Promise.all(allContentNames.map(async name => {
        // Add the directory path to the name. e.g. meme01.jpg -> /path/to/memes/meme01.jpg
        const contentAbsPath: string = join(absPath, name);
        // Get info about the item.
        const contentInfo: Stats = await stat(contentAbsPath);
        // If the item is a file we may want to keep it
        if(contentInfo.isFile()) {
          // Some files have a mime type that begins with 'image/' that aren't valid images we can render in a UI
          // We'll check to see if this file is one of those dumb ones and ignore it if so
          const fileExt: string = extname(contentAbsPath);
          if (knownExtensionsToIgnore.has(fileExt))
            return null;

          // This file doesn't have a dumb extension, so now we'll check what it's type is by checking its contents
          const fileType: FileTypeResult = await fromFile(contentAbsPath);
          const isImage: boolean = fileType?.mime?.startsWith('image/') ?? false;
          // If the file is an image file we'll keep it, otherwise return null
          return isImage ? contentAbsPath : null;
        } else {
          // If the item is not a file we don't want to keep it
          return null;
        }
      }));

      // Shake out any null items in our list that came from
      // non-file directory items or items that were not images
      return fileAbsPaths.filter(tuple => !!tuple?.length);
    })();

    // Return the file path of the image in the list that comes after the last image we returned
    const dividend: number = ++lastImgIdx;
    const divisor: number = (allFilePaths || []).length;
    lastImgIdx = dividend['modulo'](divisor);
    const fileStream: ReadStream = createReadStream(allFilePaths[lastImgIdx]);
    res.status(200);
    fileStream.pipe(res);
  });

  expressApp.put('/settings', async (req, res) => {
    const settings: {
      absPath: string;
      carouselLoc: string;
      imageDurationMs: number
    } = req.body;

    // Validations

    if (!settings.absPath?.length) {
      res.status(400).send('Image folder was not set. Please review your settings.');
      return;
    } else if (!settings.carouselLoc?.length) {
      res.status(400).send('OBS Browser Source location was not set. Please review your settings.');
      return;
    } else if (isNaN(settings.imageDurationMs)) {
      res.status(400).send('Image duration was not set. Please review your settings.');
      return;
    } else if (settings.imageDurationMs === 0) {
      res.status(400).send('Image duration needs to be greater than 0.\nPlease review your settings.');
      return;
    }

    let dirIsValid: boolean = existsSync(settings.absPath);
    if (!dirIsValid) {
      res.status(400).send('The image folder path provided does not exist.\nPlease review your settings.');
      return;
    }
    dirIsValid = existsSync(settings.carouselLoc);
    if (!dirIsValid) {
      res.status(400).send('The OBS Browser Source could not be found at the path provided.\nPlease review your settings.');
      return;
    }

    if (absPath !== settings.absPath) {
      absPath = settings.absPath;
      lastImgIdx = -1;
    }

    // So the user doesn't have to enter the path to their image directory every time
    // We ask them to tell us once where the index.html it located and we overwrite it with their settings
    const indexFileStr: string = await readFile(settings.carouselLoc, 'utf-8');
    const xmlDoc: Document = new DOMParser().parseFromString(indexFileStr, 'text/html');

    // The settings are stored under a <label> with an id called 'settings'
    const settingEl: Element = xmlDoc.getElementById('settings');
    // We serialize our settings then write them to the label element's text content
    settingEl.textContent = JSON.stringify(settings, null, 2);

    // Now we convert our XML back to a string and write it to the index.html file
    const updatedIndexFileStr: string = new XMLSerializer().serializeToString(xmlDoc).replace('&amp;', '&');
    await writeFile(settings.carouselLoc, updatedIndexFileStr, 'utf-8');

    res.sendStatus(200);
  });

  // Turn on our server so it can listen for requests from the OBS Browser source
  let startupErrorMsg: string;
  let expressServer: Server;
  await new Promise<void>(resolve => {
    expressServer = expressApp.listen(2222, (error?: Error) => {
      if (error)
        startupErrorMsg = error.message;
      resolve();
    });
  });

  // Set the message to display in the Photo Carousel App's console window
  let processMsg: string = startupErrorMsg?.length
    ? [
      'Looks like there\'s been an error.',
      `Error Message: "${startupErrorMsg}"`,
      'Message Torty he can look into it.'
    ].join('\n')
    : 'The Photo Carousel App is running and listening for requests from your OBS Browser source!';
  processMsg += '\n\nPress any key at any time to stop the app.';

  (process.title as string) = 'OBS Photo Carousel';
  console.clear();
  console.log(processMsg);

  emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY)
    process.stdin.setRawMode(true);

  await once(process.stdin, 'keypress')

  expressServer.close((err?: Error) => process.exit(+(!!err)));
};

run().catch(console.error);
