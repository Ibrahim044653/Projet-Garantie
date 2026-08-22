import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { logger } from './services/logger';
import { authRouter } from './routes/auth.routes';
import { hypothequeRouter } from './routes/hypotheque.routes';
import { dashboardRouter } from './routes/dashboard.routes';
import { dashboardConfigRouter } from './routes/dashboard-config.routes';
import { reportingRouter } from './routes/reporting.routes';
import { userRouter } from './routes/user.routes';
import { alerteRouter } from './routes/alerte.routes';
import { clientRouter } from './routes/client.routes';
import { pretRouter } from './routes/pret.routes';
import { workflowRouter } from './routes/workflow.routes';
import { provisionRouter } from './routes/provision.routes';
import { scoringRouter } from './routes/scoring.routes';
import { reportingBceaoRouter } from './routes/reporting-bceao.routes';
import { gedRouter } from './routes/ged.routes';
import { assuranceRouter } from './routes/assurance.routes';
import { biRouter } from './routes/bi.routes';
import { notificationRouter } from './routes/notification.routes';
import { reevaluationRouter } from './routes/reevaluation.routes';
import { expertRouter } from './routes/expert.routes';
import { exportPlanifieRouter } from './routes/export-planifie.routes';
import { uploadRouter } from './routes/upload.routes';
import { mainleveeRouter } from './routes/mainlevee.routes';
import { recouvrementRouter } from './routes/recouvrement.routes';
import { auditRouter } from './routes/audit.routes';
import { searchRouter } from './routes/search.routes';
import { importRouter } from './routes/import.routes';
import { simulationRouter } from './routes/simulation.routes';
import { iaRouter } from './routes/ia.routes';
import { generateAlerts } from './services/alert.service';
import { notifyShortfall, notifyExpertiseExpiring } from './services/notification.service';

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, callback) => {
    const ok = !origin ||
      allowedOrigins.some((o) => origin.startsWith(o.trim()));
    if (ok) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/hypotheques', hypothequeRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/dashboard', dashboardConfigRouter);
app.use('/api/reporting', reportingRouter);
app.use('/api/users', userRouter);
app.use('/api/admin/users', userRouter);
app.use('/api/alertes', alerteRouter);
app.use('/api/clients', clientRouter);
app.use('/api/prets', pretRouter);
app.use('/api/workflow', workflowRouter);
app.use('/api/provisions', provisionRouter);
app.use('/api/scoring', scoringRouter);
app.use('/api/reporting-bceao', reportingBceaoRouter);
app.use('/api/ged', gedRouter);
app.use('/api/assurances', assuranceRouter);
app.use('/api/bi', biRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api', reevaluationRouter);
app.use('/api/experts', expertRouter);
app.use('/api/exports-planifies', exportPlanifieRouter);
app.use('/api/uploads', uploadRouter);
app.use('/api/mainlevees', mainleveeRouter);
app.use('/api/recouvrement', recouvrementRouter);
app.use('/api/audit', auditRouter);
app.use('/api/search', searchRouter);
app.use('/api/import', importRouter);
app.use('/api/simulation', simulationRouter);
app.use('/api/ia', iaRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);

  // Run alert generation at startup
  try {
    const alerts = await generateAlerts();
    logger.info('Alert generation completed at startup');
    // Envoyer des notifications pour les alertes critiques
    if (alerts && Array.isArray(alerts)) {
      for (const { type, hypotheque } of alerts) {
        try {
          if (type === 'SHORTFALL') await notifyShortfall(hypotheque);
          else if (type === 'EXPERTISE_BIENTOT_EXPIREE') await notifyExpertiseExpiring(hypotheque);
        } catch (ne) {
          logger.error('Notification post-alerte échouée:', ne);
        }
      }
    }
  } catch (err) {
    logger.error('Alert generation failed at startup:', err);
  }

  // Schedule daily alert generation (every 24h)
  setInterval(async () => {
    try {
      const alerts = await generateAlerts();
      logger.info('Daily alert generation completed');
      if (alerts && Array.isArray(alerts)) {
        for (const { type, hypotheque } of alerts) {
          try {
            if (type === 'SHORTFALL') await notifyShortfall(hypotheque);
            else if (type === 'EXPERTISE_BIENTOT_EXPIREE') await notifyExpertiseExpiring(hypotheque);
          } catch (ne) {
            logger.error('Notification post-alerte échouée:', ne);
          }
        }
      }
    } catch (err) {
      logger.error('Daily alert generation failed:', err);
    }
  }, 24 * 60 * 60 * 1000);
});

export default app;
