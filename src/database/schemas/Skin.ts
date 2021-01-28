import { model, Schema } from "mongoose";
import { Maybe, modelToVariant } from "../../util";
import { ISkinDocument } from "../../typings";
import { ISkinModel, SkinModel, SkinVisibility } from "../../typings/ISkinDocument";
import { SkinInfo } from "../../typings/SkinInfo";

export const SkinSchema: Schema<ISkinDocument, ISkinModel> = new Schema({
    id: {
        type: Number,
        index: true,
        unique: true
    },
    hash: {
        type: String,
        index: true
    },
    name: {
        type: String,
        index: true
    },
    uuid: {
        type: String,
        index: true
    },
    model: {
        type: String,
        enum: ["steve", "slim", "unknown"],
        index: true
    },
    variant: {
        type: String,
        enum: ["classic", "slim", "unknown"]
    },
    visibility: {
        type: Number,
        index: true
    },
    value: String,
    signature: String,
    url: {
        type: String,
        index: true
    },
    minecraftTextureHash: {
        type: String,
        index: true
    },
    skinId: String,
    skinTextureId: String,
    minecraftSkinId: String,
    textureHash: String,
    capeUrl: {
        type: String
    },
    time: {
        type: Number,
        index: true
    },
    generateDuration: Number,
    account: Number,
    type: String,
    duplicate: Number,
    views: Number,
    via: String,
    server: String,
    ua: String,
    apiVer: String,
    testerRequest: Boolean,
    testerMismatchCounter: Number
}, { id: false })

/// METHODS

SkinSchema.methods.toResponseJson = function (this: ISkinDocument, delay?: number): SkinInfo {
    const info: SkinInfo = {
        id: this.id,
        idStr: "" + this.id,
        name: this.name || "",
        model: this.model,
        variant: modelToVariant(this.model),
        data: {
            uuid: this.uuid,
            texture: {
                value: this.value,
                signature: this.signature,
                url: this.url,
                urls: {
                    skin: this.url,
                    cape: this.capeUrl
                }
            }
        },
        timestamp: Math.round(this.time) || 0,
        duration: this.generateDuration || 0,
        accountId: this.account || 0,
        server: this.server || "unknown",
        private: this.visibility == SkinVisibility.PRIVATE,
        views: this.views
    };
    if (delay) {
        info.nextRequest = delay;
    }
    return info;
};

/// STATICS

SkinSchema.statics.findForId = function ( id: number): Promise<ISkinDocument | null> {
    return Skin.findOne({ id: id }).exec();
};

SkinSchema.statics.attachTesterResult = function ( id: number, server: string, mismatchCount: number): Promise<ISkinDocument | null> {
    return Skin.findOneAndUpdate({ id: id, server: server }, { testerRequest: true, testerMismatchCounter: mismatchCount }).exec();
};

export const Skin: ISkinModel = model<ISkinDocument, ISkinModel>("Skin", SkinSchema);
