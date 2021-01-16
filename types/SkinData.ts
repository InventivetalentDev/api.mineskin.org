import { ProfileProperty } from "./ProfileResponse";
import exp = require("constants");

export interface SkinData extends ProfileProperty {
    decodedValue?: SkinValue;
}

export interface SkinMeta {
    uuid: string;
    imageHash: string;
    mojangHash: string;
}

export interface TextureMetadata {
    model?: string;
}

export interface Texture {
    url: string;
    metadata?: TextureMetadata;
}

export interface Textures {
    SKIN?: Texture;
    CAPE?: Texture;
}

export interface SkinValue {
    profileId: string;
    profileName: string;
    signatureRequired: boolean;
    textures: Textures;
}
