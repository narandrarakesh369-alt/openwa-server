import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { SessionService } from '../session/session.service';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { SendTextMessageDto, SendMediaMessageDto, SendAudioMessageDto, MessageResponseDto } from './dto';
import { SendTemplateMessageDto } from './dto/send-template.dto';
import { Message, MessageStatus } from './entities/message.entity';
import { HookManager } from '../../core/hooks';
import { SendPacingService } from './send-pacing.service';
import { TemplateService } from '../template/template.service';
import { ChatMediaArchiveService } from '../chat-media/chat-media-archive.service';
export declare const DEFAULT_TEMPLATE_RENDER_MAX_CHARS: number;
export interface SaveOutgoingMessageData {
    waMessageId?: string;
    chatId: string;
    body?: string;
    type: string;
    timestamp?: number;
    status?: MessageStatus;
    metadata?: Record<string, unknown>;
    quotedMessageId?: string;
}
export declare class MessageSendService {
    private readonly messageRepository;
    private readonly sessionService;
    private readonly engines;
    private readonly hookManager;
    private readonly templateService;
    private readonly pacing;
    private readonly configService?;
    private readonly chatMediaArchive?;
    private readonly logger;
    constructor(messageRepository: Repository<Message>, sessionService: SessionService, engines: EngineRegistry, hookManager: HookManager, templateService: TemplateService, pacing: SendPacingService, configService?: ConfigService | undefined, chatMediaArchive?: ChatMediaArchiveService | undefined);
    sendText(sessionId: string, dto: SendTextMessageDto): Promise<MessageResponseDto>;
    private applySendingGate;
    private failSend;
    sendTemplate(sessionId: string, dto: SendTemplateMessageDto): Promise<MessageResponseDto>;
    sendImage(sessionId: string, dto: SendMediaMessageDto): Promise<MessageResponseDto>;
    sendVideo(sessionId: string, dto: SendMediaMessageDto): Promise<MessageResponseDto>;
    sendAudio(sessionId: string, dto: SendAudioMessageDto): Promise<MessageResponseDto>;
    sendDocument(sessionId: string, dto: SendMediaMessageDto): Promise<MessageResponseDto>;
    sendLocation(sessionId: string, dto: {
        chatId: string;
        latitude: number;
        longitude: number;
        description?: string;
        address?: string;
        quotedMessageId?: string;
    }): Promise<MessageResponseDto>;
    sendContact(sessionId: string, dto: {
        chatId: string;
        contactName: string;
        contactNumber: string;
        quotedMessageId?: string;
    }): Promise<MessageResponseDto>;
    sendPoll(sessionId: string, dto: {
        chatId: string;
        name: string;
        options: string[];
        allowMultipleAnswers?: boolean;
        quotedMessageId?: string;
    }): Promise<MessageResponseDto>;
    sendSticker(sessionId: string, dto: SendMediaMessageDto): Promise<MessageResponseDto>;
    reply(sessionId: string, dto: {
        chatId: string;
        quotedMessageId: string;
        text: string;
        mentions?: string[];
    }): Promise<MessageResponseDto>;
    forward(sessionId: string, dto: {
        fromChatId: string;
        toChatId: string;
        messageId: string;
    }): Promise<MessageResponseDto>;
    saveOutgoingMessage(sessionId: string, data: SaveOutgoingMessageData): Promise<Message>;
    private emitPersisted;
    private get archiveOutboundEnabled();
    private saveFailedMessage;
    private persistSentState;
    private getEngine;
    private simulateTypingIfEnabled;
    private toClientFacingError;
    private buildMediaInput;
}
