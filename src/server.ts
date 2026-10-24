import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import filesRoutes from './modules/onboarding/files.routes';

// Routes
import authRoutes       from './modules/auth/auth.routes';
import inviteRoutes     from './modules/onboarding/invites.routes';
import onboardingRoutes from './modules/onboarding/onboarding.routes';
import documentRoutes   from './modules/onboarding/documents.routes';
import contractRoutes   from './modules/onboarding/contracts.routes';
import userRoutes       from './modules/auth/users.routes';
import leaveRoutes      from './modules/leave-management/routes';

import leaveSetupRoutes from './modules/leave/leave.routes';
import eimsRoutes from './modules/employee_information/employee_information_audit.routes';
import attendanceRoutes from './modules/attendance/attendance.routes';
import eimAdminRoutes from './modules/eim/eim.routes';
import reportingHierarchyRoutes from './modules/reporting_hierarchy/reporting_hierarchy.routes';
import accessControlRoutes from './modules/access_control/access_control.routes';
import performanceRoutes from './modules/performance/performance.routes';
import assistantRoutes from './modules/assistant/routes';
import organizationRoutes from './shared/organization.routes';

// Middleware
import { errorHandler, notFoundHandler } from './middleware/validate';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ─── Core Middleware ──────────────────────────────────────────────────────────

const allowedOrigins=new Set([
  ...(process.env.FRONTEND_URL||'').split(',').map(origin=>origin.trim().replace(/\/$/,'')).filter(Boolean),
  ...(process.env.NODE_ENV==='production'?[]:['http://localhost:5174','http://127.0.0.1:5174','http://localhost:5173','http://127.0.0.1:5173'])
]);
app.use(cors({
  origin: (origin,callback)=>callback(null,!origin||allowedOrigins.has(origin)),
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'HR API',
    version: '1.0.0',
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use('/api/auth',       authRoutes);
app.use('/api/users',      userRoutes);

app.use('/api/invites',    inviteRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/documents',  documentRoutes);
app.use('/api/files', filesRoutes);
app.use('/uploads', filesRoutes); // Legacy links still require the same authorization.
app.use('/api/contracts',  contractRoutes);
app.use('/api/employee_information/audit', eimsRoutes);

app.use('/api/leaves',     leaveRoutes);
app.use('/api/leave-management', leaveSetupRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/eim',        eimAdminRoutes);
app.use('/api/reporting-hierarchy', reportingHierarchyRoutes);
app.use('/api/access-control', accessControlRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/organization', organizationRoutes);

// ─── Error Handlers ───────────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║     Peoples HR API Server (Core)      ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');
  console.log(`  🚀 Server running at:  http://localhost:${PORT}`);
  console.log(`  🏥 Health check:       http://localhost:${PORT}/health`);
  console.log(`  🗄️  Database:           ${process.env.DATABASE_PROVIDER === 'dynamodb' ? 'DynamoDB' : 'Local MySQL'}`);
  console.log(`  🌍 Frontend CORS:      ${process.env.FRONTEND_URL ?? 'http://localhost:5174'}`);
  console.log('');
});

export default app;
