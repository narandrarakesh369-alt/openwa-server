import { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
export declare class ProxyAwareThrottlerGuard extends ThrottlerGuard {
    private warnedSharedProxyBucket;
    protected getTracker(req: Record<string, unknown>): Promise<string>;
    protected shouldSkip(context: ExecutionContext): Promise<boolean>;
}
