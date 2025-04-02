import {BusinessExceptionAbstract} from '../business-exception.abstract';

export class ObsSourceFileNotFoundException extends BusinessExceptionAbstract {
  public readonly errMsg: string = 'The OBS Browser Source could not be found at the path provided.\nPlease review your settings.';
  public readonly code: number = 404;
}
