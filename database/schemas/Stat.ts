import { Model, model, Schema } from "mongoose";
import { IStatDocument } from "../../types";
import { IStatModel } from "../../types/IStatDocument";

const schema: Schema = new Schema(
    {
        key: String,
        value: Number
    },
    {
        collection: "stats"
    });

schema.statics.inc = function (this: IStatModel, key: string, amount = 1): Promise<void> {
    return this.findOne({ key: key }).exec().then((stat: IStatDocument) => {
        if (!stat) {
            console.warn("Invalid stat key " + key);
            return undefined;
        }
        stat.value += amount;
        return stat.save();
    })
};

export const Stat: IStatModel = model<IStatDocument, IStatModel>("Stat", schema);