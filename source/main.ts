import express from 'express';
import type {Express} from 'express-serve-static-core';
import {once} from 'node:events';
import type {Server} from 'http';
import {XMLReader} from '@xmldom/xmldom/lib/sax';
import {emitKeypressEvents} from 'node:readline';
import {BusinessLayer} from './business-layer';
import {Controller} from './controller';

declare global {
  interface Number {
    modulo(divisor: number): number;
  }
}

// Remember the % operator is a remainder operator. NOT a modulo operator.
// To perform a modulo operation you need to do ((a % n ) + n ) % n
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Remainder
// Which we're adding here as an available function for any primitive number type for convenience
Number.prototype.modulo = function (divisor: number): number {
  return ((this % divisor) + divisor) % divisor;
};

// Monkey-patch the XMLReader used by DOMParser to not get mad at query params in stylesheet links
const originalParser: Function = XMLReader.prototype.parse;
XMLReader.prototype.parse = function (source: string, defaultNSMap: object, entityMap: Record<string, string>): string {
  // XMLParser thinks our &icon_names= in the [href] of our <link> element is a symbol to be replace like &amp; => &
  // So when it sees &icon_names it wants to know what to convert it to. We tell it to convert it to its current value
  const customEntitiesMap: Record<string, string> = {
    'icon_names': '&icon_names'
  };
  return originalParser.call(this, source, defaultNSMap, {
    ...entityMap,
    ...customEntitiesMap
  });
};

const run = async () => {
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

  const controller: Controller = new Controller(new BusinessLayer());
  expressApp.post('/source', (req, res) => controller.registerImageSource(req, res));
  expressApp.get('/health', (_, res) => controller.getHealthStatus(res));
  expressApp.get('/next', async (_, res) => await controller.getNextImage(res));
  expressApp.put('/settings', async (req, res) => await controller.updateAppSettings(req, res));

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
