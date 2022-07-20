import express, { Express } from 'express';
import { join } from 'path';
import { createServer } from 'https';
import { isRunningOnDeveloperPC, sslOptions } from './demo-utils';
import { create } from 'express-handlebars';
import { MainApp, VHostApp } from '@core/express/express-apps';
import { getAppsAndNodes } from './apps';

const relative = (dir: string) => join(__dirname, dir);

(async () => {
  const { websites, clientNodes, operators, cdns } = await getAppsAndNodes();

  const mainApp = new MainApp();

  // Add demo middlewares to websites and CDNs
  const hbs = create({ defaultLayout: false });
  [...websites, ...cdns]
    .map((app) => app.expressApp)
    .forEach((app: Express) => {
      app.engine('hbs', hbs.engine);
      app.set('view engine', 'hbs');
      app.set('views', relative('/views'));
      app.use(
        express.static(relative('../public'), {
          setHeaders: (res, filePath) => {
            if (/(woff|woff2|ttf|css)$/.test(filePath)) {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Cache-Control', 'public, max-age=604800');
            }
            if (/(js)$/.test(filePath)) {
              // Shorter cache for JS as this might change more during development.
              // CORS needed to support easy publisher evaluation.
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Cache-Control', 'public, max-age=60');
            }
          },
        })
      );
    });

  const allApps: VHostApp[] = [
    ...websites,
    ...cdns,
    ...operators.map((operator) => operator.app),
    ...clientNodes.map((clientNode) => clientNode.app),
  ];

  // Add vhosts
  allApps.forEach((app: VHostApp) => {
    mainApp.addVhostApp(app);
  });

  // Warmup Requests to Improve Performance on Google Cloud Platform
  mainApp.expressApp.get('/_ah/warmup', (req, res) => {
    res.sendStatus(200);
  });

  // start the Express server
  const port = process.env.PORT || 80;
  mainApp.expressApp.listen(port, () => {
    // Demo specific logs
    console.log(`server started on port ${port}`);
    console.log('');
    console.log('Listening on:');
    for (const app of allApps) {
      console.log(`${app.hostName} (${app.name})`);
    }
    if (isRunningOnDeveloperPC) {
      console.log('');
      console.log('Make sure you have added these lines to your /etc/hosts file or equivalent:');
      for (const app of allApps) {
        console.log(`127.0.0.1 ${app.hostName} # [PAF] ${app.name}`);
      }
    }
  });

  // Only start HTTPS on local dev: on prod, the HTTPS layer is handled by a proxy
  if (isRunningOnDeveloperPC) {
    console.log('Local dev: starting HTTPs (443) server');
    createServer(sslOptions, mainApp.expressApp).listen(443);
  }
})();
