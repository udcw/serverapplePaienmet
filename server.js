require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');

const app = express();

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Désactiver pour le développement
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration complète
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:8081',
    'exp://localhost:8081',
    'http://127.0.0.1:3000',
    'https://apple-paiement.mon-reves.com',
    'https://paiement.culturesnews.com',
    'culturesnews://'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400, // 24 heures
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Middleware pour les requêtes pré-vol (preflight)
app.options('*', cors());

// Body parser avec limites augmentées
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Logging des requêtes
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  if (req.method === 'POST' || req.method === 'PUT') {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    error: 'Trop de requêtes, veuillez réessayer plus tard.',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false
});
app.use('/api/', limiter);

// Import des routes
const paymentRoutes = require('./routes/payment');
const webhookRoutes = require('./routes/webhooks');

// Routes
app.use('/api/payment', paymentRoutes);
app.use('/webhooks', webhookRoutes);

// Routes de test
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Cultures News Payment API',
    version: '1.0.0'
  });
});

app.get('/test', (req, res) => {
  res.json({ 
    message: 'Server is running properly',
    endpoints: {
      health: '/health',
      generateToken: '/api/payment/generate-token (POST)',
      initiatePayment: '/api/payment/initiate (POST)',
      checkStatus: '/api/payment/status/:id (GET)'
    }
  });
});

// Route pour vérifier la configuration
app.get('/config', (req, res) => {
  res.json({
    node_env: process.env.NODE_ENV,
    port: process.env.PORT,
    maviance_base_url: process.env.MAVIANCE_BASE_URL ? 'Configured' : 'Missing',
    supabase_url: process.env.SUPABASE_URL ? 'Configured' : 'Missing'
  });
});

// Route de fallback pour les deep links
app.get('/payment-success/:userId', (req, res) => {
  const { userId } = req.params;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Paiement Réussi - Cultures News</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <script>
        setTimeout(() => {
          window.location.href = "culturesnews://payment-success?userId=${userId}";
        }, 1000);
      </script>
    </head>
    <body style="background: linear-gradient(135deg, #8B0000 0%, #4B0082 100%); display: flex; justify-content: center; align-items: center; height: 100vh;">
      <div style="background: white; padding: 40px; border-radius: 20px; text-align: center;">
        <h1 style="color: #27AE60;">✅ Paiement Réussi !</h1>
        <p>Votre compte premium a été activé.</p>
        <p>Redirection vers l'application...</p>
      </div>
    </body>
    </html>
  `);
});

// Gestion des erreurs 404
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route non trouvée',
    path: req.originalUrl,
    method: req.method,
    availableRoutes: ['/health', '/api/payment/*', '/webhooks/*']
  });
});

// Gestionnaire d'erreurs global
app.use((err, req, res, next) => {
  console.error('❌ Global Error:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    body: req.body
  });
  
  res.status(err.status || 500).json({ 
    error: 'Erreur interne du serveur',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    requestId: Date.now().toString(36) + Math.random().toString(36).substr(2)
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 Test: http://localhost:${PORT}/test`);
  console.log(`⚙️ Config: http://localhost:${PORT}/config`);
});