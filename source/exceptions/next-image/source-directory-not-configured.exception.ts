import {BusinessExceptionAbstract} from '../business-exception.abstract';

export class SourceDirectoryNotConfiguredException extends BusinessExceptionAbstract {
  public readonly errMsg: string = 'Image folder was not set.\nPlease review your settings.';
  public readonly code: number = 400;
}
