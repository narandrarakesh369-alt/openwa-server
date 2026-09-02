"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL_MEDIA_501 = exports.ENGINE_NOT_SUPPORTED_501 = exports.LABEL_NOT_FOUND_404 = exports.GROUP_NOT_FOUND_404 = exports.CUSTOM_LINK_PREVIEW_501 = exports.CHANNEL_INVITE_NOT_FOUND_404 = exports.CHANNEL_NOT_FOUND_404 = exports.MESSAGE_NOT_FOUND_404 = exports.ENGINE_REFUSED_403 = exports.RECIPIENT_UNREACHABLE_400 = exports.SESSION_NOT_STARTED_404 = exports.PAIRING_NOT_READY_409 = exports.ENGINE_NOT_READY_409 = void 0;
exports.ENGINE_NOT_READY_409 = 'The session is not connected — an engine exists for it but is not `ready`: disconnected, ' +
    'reconnecting, or still initializing, so the request never reached WhatsApp. Wait for `ready` and ' +
    'retry. A session that was never started answers `400` instead, and the session lifecycle routes ' +
    'answer `409` for a conflicting state rather than this. One window answers this while the session ' +
    'still reads `ready`: WhatsApp Web periodically reloads its own page and the engine re-injects ' +
    'into it — for those few seconds the answer is a `409` naming the reload; retry shortly.';
exports.PAIRING_NOT_READY_409 = 'The session is not waiting to be linked: the engine is still connecting, or reconnecting after a ' +
    'drop, so the request never reached WhatsApp. Wait for `status` to read `qr_ready` and retry. Once a ' +
    'code has been accepted the session moves through `authenticating` and `initializing` to `ready` and ' +
    'answers this until then; wait for `ready` in that case. A session that reads `ready` is already ' +
    'linked and answers `400` instead. One window answers this while the session still reads ' +
    '`qr_ready`: on the Baileys engine a socket that has begun closing stops accepting a pairing ' +
    'request before the status catches up, which on a silently dropped connection takes until the ' +
    "WebSocket's close timeout (30 s); retry, and the status follows shortly.";
exports.SESSION_NOT_STARTED_404 = 'No session is running under that id — it was never started, was stopped, or does not exist. These ' +
    'routes report an unstarted session as `404`, where the message and group routes report it as `400`.';
exports.RECIPIENT_UNREACHABLE_400 = 'The request was rejected before anything was sent. Among the causes: the recipient could not be ' +
    'addressed — WhatsApp reports no deliverable id for that `chatId`, which is how it says the number ' +
    'is not on WhatsApp — as well as body validation and a session that is not active.';
exports.ENGINE_REFUSED_403 = 'WhatsApp refused the operation. The request was well formed — the refusal happened WhatsApp-side, ' +
    'most often because the account lacks the admin rights the operation requires.';
exports.MESSAGE_NOT_FOUND_404 = "No such message — the id is outside the engine's lookup window (roughly the last hundred messages " +
    'of the chat, or absent from the Baileys store) or the message was revoked.';
exports.CHANNEL_NOT_FOUND_404 = "No such channel — the id is not among the session's subscribed channels, either because it is " +
    'wrong or because the channel has not synced into the local collection yet.';
exports.CHANNEL_INVITE_NOT_FOUND_404 = 'The invite code does not resolve to a channel — it is wrong, expired, or revoked. This route takes ' +
    'an invite code rather than a channel id.';
exports.CUSTOM_LINK_PREVIEW_501 = 'A caller-supplied `customLinkPreview` is not supported by the whatsapp-web.js engine — only ' +
    'Baileys can attach one. The send itself is supported on both; omit the field, or use `linkPreview`.';
exports.GROUP_NOT_FOUND_404 = 'No such group — the id is unknown.';
exports.LABEL_NOT_FOUND_404 = 'No such label — it was never created, or the account is not a WhatsApp Business one and holds no ' +
    'labels at all. Both are the same answer to the caller.';
exports.ENGINE_NOT_SUPPORTED_501 = 'The active engine cannot serve this operation. It is part of the engine contract, but the engine ' +
    'currently running has no implementation for it.';
exports.CHANNEL_MEDIA_501 = 'Sending media to a channel (`<id>@newsletter`) is not supported by the whatsapp-web.js engine — ' +
    'the page method it needs was removed by a WhatsApp Web update. Text to a channel still works.';
//# sourceMappingURL=engine-status-responses.js.map