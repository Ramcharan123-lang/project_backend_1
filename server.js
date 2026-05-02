import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

// Load routes
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import groupRoutes from './routes/groupRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import submissionRoutes from './routes/submissionRoutes.js';

// Load Sequelize & Models
import { initializeDatabase } from './config/database.js';
import { sequelize, User, Group, Project, Task, Message } from './models/index.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/submissions', submissionRoutes);

// Database connection
const connectDB = async () => {
  try {
    console.log('Connecting to Database...');
    if (process.env.DATABASE_URL) {
      console.log('Production mode: Connecting to PostgreSQL on Render');
    } else {
      console.log('Local mode: Connecting to MySQL');
    }
    
    await initializeDatabase();
    await sequelize.authenticate();
    console.log('Database connection established successfully');

    // Sync models
    console.log('Syncing models...');
    await sequelize.sync({ alter: true }); 
    console.log('Models synced successfully');
    
    // Seed Database if empty
    const userCount = await User.count();
    if (userCount === 0) {
      console.log('Database empty, seeding init data...');
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('password123', salt);
      
      const admin = await User.create({ name: 'Admin User', email: 'admin@admin.com', password: hashedPassword, role: 'admin' });
      const student = await User.create({ name: 'Student User', email: 'student@student.com', password: hashedPassword, role: 'student' });
      const group = await Group.create({ name: 'Alpha Group' });
      
      student.groupId = group.id;
      await student.save();
      
      const project = await Project.create({ 
        title: 'Full Stack Web App', 
        description: 'Build a project management platform with React and Node.js.', 
        assignedGroup: group.id, 
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) 
      });
      
      await Task.create({ title: 'Design Landing Page', description: 'Create UI for the landing page', assignedTo: student.id, projectId: project.id, status: 'completed' });
      await Task.create({ title: 'Setup Backend API', description: 'Create REST endpoints', assignedTo: student.id, projectId: project.id, status: 'pending' });
      
      console.log('Database seeded successfully');
    }
    
  } catch (err) {
    console.error('CRITICAL STARTUP ERROR:', err);
    process.exit(1); // Force exit so Render knows it failed
  }
};
connectDB();

// Socket.io for Real-Time chat
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('register_user', (userId) => {
    socket.join(userId);
    console.log(`Socket ${socket.id} registered for private messages as ${userId}`);
  });

  socket.on('join_group', (groupId) => {
    socket.join(groupId);
    console.log(`Socket ${socket.id} joined group ${groupId}`);
  });

  socket.on('send_message', async (data) => {
    const { sender, groupId, receiverId, content } = data;
    try {
      const isGlobal = groupId === 'global';
      const message = await Message.create({ 
        sender, 
        groupId: isGlobal ? null : (groupId || null), 
        receiverId: receiverId || null, 
        content 
      });
      const populatedMsg = await Message.findByPk(message.id, { include: ['sender_obj'] });
      
      const json = populatedMsg.toJSON();
      if(json.sender_obj) {
        json.sender = json.sender_obj;
        json.sender._id = json.sender.id;
        delete json.sender_obj;
      }
      
      if (isGlobal) {
        io.to('global').emit('receive_message', json);
      } else if (groupId) {
        io.to(groupId).emit('receive_message', json);
      } else if (receiverId) {
        io.to(receiverId).to(sender).emit('receive_message', json);
      }
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
