require('dotenv').config();
const express = require('express');
const { expressjwt: jwt } = require('express-jwt');
const jwksRsa = require('jwks-rsa');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear el cuerpo de la petición como JSON
app.use(express.json());

// --- Configuración de OAuth2/JWT ---
const LiferayIssuerURL = process.env.LIFERAY_ISSUER_URL;
const JWTAudience = process.env.JWT_AUDIENCE;
const ProjectPath = process.env.PROJECT_PATH;

if (!LiferayIssuerURL || !JWTAudience || !ProjectPath) {
  console.error('Error: Las variables de entorno LIFERAY_ISSUER_URL, JWT_AUDIENCE y PROJECT_PATH deben estar definidas en .env');
  process.exit(1);
}

// Configura el middleware de autenticación JWT
const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `${LiferayIssuerURL}/.well-known/jwks` // Liferay's JWKS endpoint
  }),

  // Valida el audience y el issuer
  audience: JWTAudience,
  issuer: LiferayIssuerURL,
  algorithms: ['RS256'] // Liferay usa RS256 para JWTs
});

// Manejador de errores para JWT
app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    return res.status(err.status).send({ message: err.message });
  }
  next(err);
});

// --- Endpoint del Webhook ---
app.post('/api/v1/trigger-extraction', checkJwt, (req, res) => {
  console.log(`[${new Date().toISOString()}] Petición de extracción recibida. ID de usuario JWT:`, req.auth ? req.auth.sub : 'N/A');
  // Puedes acceder a más datos del token JWT a través de req.auth

  // Responder inmediatamente para no bloquear la petición de Liferay
  res.status(202).send({ message: 'Proceso de build iniciado en segundo plano.' });

  // Ejecutar el comando de build en segundo plano
  console.log(`[${new Date().toISOString()}] Iniciando 'npm run build' en ${ProjectPath}...`);
  exec('npm run build', { cwd: ProjectPath }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[${new Date().toISOString()}] Error durante el build: ${error.message}`);
      // Aquí podrías añadir lógica para notificar el fallo (ej: a Liferay, Slack, etc.)
      return;
    }
    if (stderr) {
      console.warn(`[${new Date().toISOString()}] Stderr durante el build:\n${stderr}`);
    }
    console.log(`[${new Date().toISOString()}] Build finalizado con éxito:\n${stdout}`);
    // Aquí podrías añadir lógica para notificar el éxito
  });
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servicio de Webhook escuchando en el puerto ${PORT}`);
  console.log(`Liferay Issuer URL: ${LiferayIssuerURL}`);
  console.log(`JWT Audience: ${JWTAudience}`);
  console.log(`Next.js Project Path: ${ProjectPath}`);
  console.log('¡ASEGÚRATE DE QUE ESTAS VARIABLES DE ENTORNO SON CORRECTAS!');
});
