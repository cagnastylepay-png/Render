const mongoose = require('mongoose');
const { Schema } = mongoose;

const BrainrotSchema = new Schema({
    Name: { type: String, required: true },
    IncomeStr: { type: String, default: "$0/s" },
    Income: { type: Number, default: 0 },
    Rarity: { type: String, default: "Common" },
    Mutation: { type: String, default: "Default" },
    Traits: { type: [String], default: [] }
}, { _id: false });

const BaseInfoSchema = new Schema({
    Name: { type: String, required: true, index: true },
    TotalPlace: { type: Number, default: 0 },
    Brainrots: { type: [BrainrotSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('BaseInfo', BaseInfoSchema);
