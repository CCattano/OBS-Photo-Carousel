import {createReadStream, existsSync, type Stats} from 'node:fs';
import {SourceDirectoryNotFoundException} from './exceptions/common/source-directory-not-found.exception';
import {readdir, readFile, stat, writeFile} from 'node:fs/promises';
import {extname, join} from 'node:path';
import {type FileTypeResult, fromFile} from 'file-type';
import type {ReadStream} from 'fs';
import {SourceDirectoryNotConfiguredException} from './exceptions/next-image/source-directory-not-configured.exception';
import {ImageSourceDto} from './types/image-source.dto';
import {Document, DOMParser, type Element, XMLSerializer} from '@xmldom/xmldom';
import {CarouselAppSettingsDto} from './types/carousel-app-settings.dto';
import {ObsSourceFileNotFoundException} from './exceptions/settings/obs-source-file-not-found.exception';

export class BusinessLayer {
  private _absPath: string = null;
  private _lastImgIdx: number = -1;
  private readonly _knownExtensionsToIgnore: Set<string> = new Set([
    '.psd', '.ras', '.pcx',
    '.pnm', '.pbm', '.pgm',
    '.ppm', '.xbm', '.xpm',
    '.xcf',
  ]);

  constructor() {
  }

  //#region CREATE

  public registerImageSource(imgSrcDto: ImageSourceDto): void {
    const dirIsValid: boolean = existsSync(imgSrcDto.absPath);
    if (!dirIsValid)
      throw new SourceDirectoryNotFoundException();

    this._absPath = imgSrcDto.absPath;
    this._lastImgIdx = -1;
  }

  //#endregion

  //#region READ

  public async getNextImage(): Promise<ReadStream> {
    if (!this._absPath?.length)
      throw new SourceDirectoryNotConfiguredException();

    const allFilePaths: string[] = await (async () => {
      // Get the name of all items in the directory
      const allContentNames: string[] = await readdir(this._absPath);

      // For each item's name turn it into a full path. e.g. meme01.jpg -> /path/to/memes/meme01.jpg
      // And only keep directory items that are files. Ignore directory items that are directories.
      // const fileAbsPaths: Array<[string, string]> = await Promise.all(allContentNames.map(async name => {
      const fileAbsPaths: string[] = await Promise.all(allContentNames.map(async name => {
        // Add the directory path to the name. e.g. meme01.jpg -> /path/to/memes/meme01.jpg
        const contentAbsPath: string = join(this._absPath, name);
        // Get info about the item.
        const contentInfo: Stats = await stat(contentAbsPath);
        // If the item is a file we may want to keep it
        if(contentInfo.isFile()) {
          // Some files have a mime type that begins with 'image/' that aren't valid images we can render in a UI
          // We'll check to see if this file is one of those dumb ones and ignore it if so
          const fileExt: string = extname(contentAbsPath);
          if (this._knownExtensionsToIgnore.has(fileExt))
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
    const dividend: number = ++this._lastImgIdx;
    const divisor: number = (allFilePaths || []).length;
    this._lastImgIdx = dividend.modulo(divisor);

    const fileStream: ReadStream = createReadStream(allFilePaths[this._lastImgIdx]);
    return fileStream;
  }
  //#endregion

  //#region UPDATE

  public async updateSettings(payloadDto: CarouselAppSettingsDto): Promise<void> {
    let dirIsValid: boolean = existsSync(payloadDto.absPath);
    if (!dirIsValid)
      throw new SourceDirectoryNotFoundException();

    dirIsValid = existsSync(payloadDto.carouselLoc);
    if (!dirIsValid)
      throw new ObsSourceFileNotFoundException();

    if (this._absPath !== payloadDto.absPath) {
      this._absPath = payloadDto.absPath;
      this._lastImgIdx = -1;
    }

    // So the user doesn't have to enter the path to their image directory every time
    // We ask them to tell us once where the photo-carousel.html is located and we overwrite it with their settings
    const indexFileStr: string = await readFile(payloadDto.carouselLoc, 'utf-8');
    const xmlDoc: Document = new DOMParser().parseFromString(indexFileStr, 'text/html');

    // The settings are stored under a <label> with an id called 'settings'
    const settingEl: Element = xmlDoc.getElementById('settings');
    // We serialize our settings then write them to the label element's text content
    settingEl.textContent = JSON.stringify(payloadDto, null, 2);

    // Now we convert our XML back to a string and write it to the index.html file
    const updatedIndexFileStr: string = new XMLSerializer().serializeToString(xmlDoc).replace('&amp;', '&');
    await writeFile(payloadDto.carouselLoc, updatedIndexFileStr, 'utf-8');
  }

  //#endregion

  //#region DELETE
  //#endregion
}
