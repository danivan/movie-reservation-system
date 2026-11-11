import { ValidationPipeOptions } from '@nestjs/common';

// Shared by the global APP_PIPE and its spec so the strictness can't drift.
export const validationPipeOptions: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};
