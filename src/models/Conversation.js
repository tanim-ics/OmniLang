import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    sender:  {
        type: String,
        enum: ['user', 'ai'],
        required: true
    },
    content: { type: String, required: true }
}, { timestamps: true, _id: false });

const conversationSchema = new mongoose.Schema({
    userId:   { type: String, required: true, index: true },
    level:    {
        type: String,
        enum: ['A1', 'A2', 'B1', 'B2', 'C1'],
        required: true
    },
    title:    { type: String, default: 'Neues Gespräch' },
    ended:    { type: Boolean, default: false, index: true },
    summary:  { type: String, default: '' },
    messages: [messageSchema]
}, { timestamps: true });

export default mongoose.model('Conversation', conversationSchema);
