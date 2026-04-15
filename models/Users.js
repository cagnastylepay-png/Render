const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema({
    Id: { type: String, required: true, unique: true, index: true },
    UseName: { type: String, default: '' },
    Hits: { type: [Date], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Users', UserSchema);