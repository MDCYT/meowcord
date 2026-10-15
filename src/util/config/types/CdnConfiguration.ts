import { EndpointConfiguration } from "./EndpointConfiguration";

export class CdnConfiguration extends EndpointConfiguration {
    resizeHeightMax: number = 1000;
    resizeWidthMax: number = 1000;
    imagorServerUrl: string | null = null;
    proxyCacheHeaderSeconds: number = 60 * 60 * 24;
    maxAttachmentSize: number = 500 * 1024 * 1024;
    storageQuota: StorageQuotaConfiguration = new StorageQuotaConfiguration();
    resizeImages: boolean = false;
    imageProcessing: CdnImageProcessingConfiguration = new CdnImageProcessingConfiguration();
}

export class CdnImageProcessingConfiguration {
    enabled: boolean = false;
    maxDimension: number = 4096;
    minDimension: number = 16;
    defaultQuality: number = 100;
    cacheMemoryBytes: number = 64 * 1024 * 1024;
}

export class CdnLimitsConfiguration {
    // ordered by route register order in CDN...
    icon: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration();
    roleIcon: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration();
    emoji: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration();
    sticker: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration();
    banner: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration();
    splash: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration();
    avatar: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration();
    discoverySplash: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration();
    appIcon: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration();
    discoverSplash: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration(); // what even is this?
    teamIcon: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration();
    channelIcon: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration(); // is this even used?
    guildAvatar: CdnImageLimitsConfiguration = new CdnImageLimitsConfiguration();
}

export class CdnImageLimitsConfiguration {
    maxHeight: number = 8192;
    maxWidth: number = 8192;
    maxSize: number = 10 * 1024 * 1024; // 10 MB
    allowAnimated: "always" | "never" | "premium" = "always";
}

export class StorageQuotaConfiguration {
    instanceBytes: number = 100 * 1024 * 1024 * 1024;
    principalBytes: number = 10 * 1024 * 1024 * 1024;
    cacheBytes: number = 1024 * 1024 * 1024;
    instanceObjects: number = 100000;
    principalObjects: number = 10000;
    cacheObjects: number = 10000;
}
