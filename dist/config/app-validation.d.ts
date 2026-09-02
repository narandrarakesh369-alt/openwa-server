import { INestApplication, ValidationPipeOptions } from '@nestjs/common';
export declare const GLOBAL_VALIDATION_OPTIONS: ValidationPipeOptions;
export declare function applyGlobalValidation(app: INestApplication): void;
