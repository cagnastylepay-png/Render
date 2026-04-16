const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema({
    Id: { type: String, required: true, unique: true, index: true }, // Discord user id
    Username: { type: String, default: '' },
    Discriminator: { type: String, default: '' },
    Avatar: { type: String, default: null },
    Hits: { type: [Date], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Users', UserSchema);
