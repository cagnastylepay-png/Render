const mongoose = require('mongoose');
const { Schema } = mongoose;

const ScriptSchema = new Schema({
    Id: { type: String, required: true, unique: true, index: true },
    UserId: { type: String, default: null },
    PasteId: { type: String, default: null },
    WebHookUrl: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Scripts', ScriptSchema);
