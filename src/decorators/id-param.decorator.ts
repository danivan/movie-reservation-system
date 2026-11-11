import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ParseIdPipe } from 'src/pipes/parse-id.pipe';

const RawParam = createParamDecorator(
  (name: string, ctx: ExecutionContext): unknown =>
    ctx.switchToHttp().getRequest().params?.[name],
);

// Custom decorator: the global ValidationPipe skips it, so ParseIdPipe sees
// the raw string (G17).
export const IdParam = () => RawParam('id', ParseIdPipe);
