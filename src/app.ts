import express from 'express';
import { router } from './routes';

const app = express();

app.use(express.json());
app.use('/api', router);

app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'SmartEdu CRM backend' });
});

export { app };