require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['https://paiement.culturesnews.com', 'culturesnews://'],
  credentials: true
}));
app.use(bodyParser.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limite each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Import des routes
const paymentRoutes = require('./routes/payment');
const webhookRoutes = require('./routes/webhooks');

app.use('/api/payment', paymentRoutes);
app.use('/webhooks', webhookRoutes);

// Route de santé
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// Gestion des erreurs 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// Gestionnaire d'erreurs global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});