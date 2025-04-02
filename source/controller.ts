import type {Request, Response} from 'express';
import type {BusinessLayer} from './business-layer';
import type {ReadStream} from 'fs';
import {ImageSourceDto} from './types/image-source.dto';
import {CarouselAppSettingsDto} from './types/carousel-app-settings.dto';
import {BusinessExceptionAbstract} from './exceptions/business-exception.abstract';

export class Controller {
  constructor(private readonly _businessLayer: BusinessLayer) {
  }

  //#region CREATE

  public registerImageSource(req: Request, res: Response): void {
    const reqPayload: ImageSourceDto = req.body;

    if (!reqPayload?.absPath?.length) {
      res.status(400).send('No folder path was provided. Please review your settings.');
      return;
    }

    try {
      this._businessLayer.registerImageSource(reqPayload);
      res.sendStatus(200);
    } catch (ex) {
      this._handleException(ex, res);
    }
  }

  //#endregion

  //#region READ

  public getHealthStatus(res: Response): void {
    res.sendStatus(200);
  }

  public async getNextImage(res: Response): Promise<void> {
    try {
      const fileStream: ReadStream = await this._businessLayer.getNextImage();
      res.status(200);
      fileStream.pipe(res);
    } catch (ex) {
      this._handleException(ex, res);
    }
  }

  //#endregion

  //#region UPDATE

  public async updateAppSettings(req: Request, res: Response): Promise<void> {
    const payloadDto: CarouselAppSettingsDto = req.body;

    // Validations

    let badReqMsg: string;
    if (!payloadDto.absPath?.length)
      badReqMsg = 'Image folder was not set. Please review your settings.';
    else if (!payloadDto.carouselLoc?.length)
      badReqMsg = 'OBS Browser Source location was not set. Please review your settings.';
    else if (isNaN(payloadDto.imageDurationMs))
      badReqMsg = 'Image duration was not set. Please review your settings.';
    else if (payloadDto.imageDurationMs === 0)
      badReqMsg = 'Image duration needs to be greater than 0.\nPlease review your settings.';


    if (badReqMsg?.length) {
      res.status(400).send(badReqMsg);
      return;
    }

    try {
      await this._businessLayer.updateSettings(payloadDto);
    } catch (ex) {
      this._handleException(ex, res);
    }

    res.sendStatus(200);
  }
  //#endregion

  //#region DELETE
  //#endregion

  //#region PRIVATE HELPER FUNCS

  private _handleException(ex: Error, res: Response): void {
    if (ex instanceof BusinessExceptionAbstract)
      res.status(ex.code).send(ex.errMsg);
    else
      res.status(500).send('An unknown error occurred. Please review your settings.');
  }

  //#endregion

}
