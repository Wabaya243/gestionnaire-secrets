// Optional real-browser acceptance test. Only a fresh local temporary database.
// npm install --no-save playwright; npx playwright install chromium
// Run from repo root: node frontend/tests/browser.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const database = path.join(tmpdir(), `gs-browser-${process.pid}.db`);
const python = process.env.TEST_PYTHON || path.join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const env = { ...process.env, PYTHONPATH: path.join(root, 'backend'),
  DATABASE_URL: `sqlite:///${database.replace(/\\/g, "/")}`, ENVIRONMENT: "development", JWT_SECRET: 'test-browser-secret-at-least-thirty-two-bytes' };
await cp(path.join(root, 'frontend/dist'), path.join(root, 'backend/static'), { recursive: true });
const server = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--port', '0'], { env, stdio: 'pipe' });
let serverLogs = ''; server.stderr.on('data', c => serverLogs += c);
let url;
let browser;
const password = 'Soutenance!Coffre-2026-Local-Long';
const fileName = 'document-confidentiel.txt';
const fileClear = 'Contenu strictement privé pour la démonstration locale.';
const errors = [], requestBodies = [];
const users = ['alice-local@example.cd', 'bob-local@example.cd', 'admin-local@example.cd'];
function py(code, input = '') {
  const r = spawnSync(python, ['-c', code], { env, input, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
function totp(secret) { return py('import sys, pyotp; print(pyotp.TOTP(sys.stdin.read()).now())', secret); }
async function login(page, email, secret) {
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe maître', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Déverrouiller', exact: true }).click();
  if (secret) {
    await page.getByLabel('Code à 6 chiffres').fill(totp(secret));
    await page.getByRole('button', { name: 'Déverrouiller', exact: true }).click();
  }
  await page.getByRole('heading', { name: 'Tableau de bord', exact: true }).waitFor();
}
try {
  for (let i = 0; i < 100; i++) {
    const address = serverLogs.match(/Uvicorn running on (http:\/\/127\.0\.0\.1:\d+)/);
    if (address) url = address[1];
    try { if (url && (await fetch(url + '/api/health')).ok) break; } catch {}
    if (i === 99) throw new Error(serverLogs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const pages = [];
  for (const email of users) {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.url().includes('/api/') && r.postData()) requestBodies.push(r.postData()); });
    await page.goto(url);
    await page.getByRole('button', { name: 'Créer un coffre', exact: true }).click();
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe maître', { exact: true }).fill(password);
    await page.getByLabel('Confirmer', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Créer le coffre', exact: true }).click();
    await page.getByRole('heading', { name: 'Ouvrir le coffre' }).waitFor();
    await login(page, email); pages.push(page); console.log('Registered and unlocked', email);
  }
  console.log('Three local accounts ready');
  const [alice, bob, admin] = pages;
  await alice.getByRole('button', { name: 'Fichiers', exact: true }).click();
  await alice.getByRole('button', { name: 'Ajouter un fichier' }).waitFor({ state: 'visible' });
  await alice.locator('input[type=file]').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from(fileClear) });
  await alice.getByRole('heading', { name: fileName, exact: true }).waitFor();
  console.log('Alice file uploaded');
  const files = await alice.evaluate(async () => (await fetch('/api/files')).json());
  const id = files.owned[0].id;
  assert(!JSON.stringify(files).includes(fileName));
  await alice.getByRole('button', { name: 'Partager', exact: true }).click();
  await alice.getByLabel('Adresse du destinataire').fill(users[1]);
  await alice.getByLabel('Adresse du destinataire').fill(users[0]);
  await alice.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await alice.getByText(/votre propre compte/).waitFor();
  await alice.getByLabel('Adresse du destinataire').fill(users[1]);
  await alice.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await alice.getByText(/Destinataire indisponible/).waitFor();
  await alice.getByText(/Activer la réception sécurisée/).first().waitFor();
  await bob.getByRole('button', { name: 'Fichiers', exact: true }).click();
  await bob.getByRole('button', { name: 'Activer la réception sécurisée' }).click();
  await bob.getByRole('button', { name: 'Copier l’empreinte' }).waitFor();
  console.log('Bob identity initialized');
  const fingerprint = await bob.locator('code').first().textContent();
  assert.equal(fingerprint.replace(/ /g, '').length, 64);
  await alice.getByRole('button', { name: 'Rechercher', exact: true }).click();
  const shareButton = alice.getByRole('button', { name: 'Chiffrer la clé et partager' });
  await shareButton.waitFor(); assert.equal(await shareButton.isDisabled(), true);
  await alice.getByLabel('Empreinte reçue du destinataire').fill(fingerprint);
  await shareButton.click(); await alice.getByRole('button', { name: 'Révoquer l’accès' }).waitFor();
  console.log('Verified share created / revocation checkpoint');
  await bob.getByRole('button', { name: 'Tableau de bord', exact: true }).click();
  await bob.getByRole('button', { name: 'Fichiers', exact: true }).click();
  await bob.getByRole('heading', { name: fileName, exact: true }).waitFor();
  const downloaded = bob.waitForEvent('download');
  await bob.getByRole('button', { name: 'Télécharger', exact: true }).click();
  const file = await downloaded; assert.equal(file.suggestedFilename(), fileName);
  assert.equal(await readFile(await file.path(), 'utf8'), fileClear);
  assert.equal(await admin.evaluate(async id => (await fetch(`/api/files/${id}/content`)).status, id), 404);
  // Refresh loses the vault key; reauthentication restores the encrypted RSA identity.
  await bob.reload(); await bob.getByRole('heading', { name: 'Ouvrir le coffre' }).waitFor();
  await login(bob, users[1]); await bob.getByRole('button', { name: 'Fichiers', exact: true }).click();
  await bob.getByRole('heading', { name: fileName, exact: true }).waitFor();
  await alice.getByRole('button', { name: 'Révoquer l’accès' }).click();
  await alice.getByText('Aucun destinataire pour ce fichier.').waitFor();
  assert.equal(await bob.evaluate(async id => (await fetch(`/api/files/${id}/content`)).status, id), 404);
  console.log('Verified share created / revocation checkpoint');
  await bob.getByRole('button', { name: 'Tableau de bord', exact: true }).click();
  await bob.getByRole('button', { name: 'Fichiers', exact: true }).click();
  await bob.getByText('Aucun partage reçu.').waitFor();
  console.log('File delivery, identity restoration and revocation verified');
  await bob.getByRole('button', { name: 'Tableau de bord', exact: true }).click();
  const bobSetup = bob.waitForResponse(r => r.url().endsWith('/api/auth/mfa/setup'));
  await bob.getByRole('button', { name: 'Activer la double authentification' }).click();
  const bobSecret = (await (await bobSetup).json()).secret;
  await bob.getByLabel('Code à 6 chiffres').fill(totp(bobSecret));
  await bob.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await bob.getByRole('button', { name: 'Désactiver la double authentification' }).waitFor();
  await bob.getByRole('button', { name: 'Désactiver la double authentification' }).click();
  const invalidCode = totp(bobSecret) === '000000' ? '999999' : '000000';
  await bob.getByLabel('Code à 6 chiffres').fill(invalidCode);
  await bob.getByRole('button', { name: 'Confirmer la désactivation' }).click();
  await bob.getByText(/Code invalide/).waitFor();
  await bob.getByLabel('Code à 6 chiffres').fill(totp(bobSecret));
  await bob.getByRole('button', { name: 'Confirmer la désactivation' }).click();
  await bob.getByRole('button', { name: 'Activer la double authentification' }).waitFor();
  console.log('MFA activation, rejection of invalid code and deactivation verified');
  const setup = admin.waitForResponse(r => r.url().endsWith('/api/auth/mfa/setup'));
  await admin.getByRole('button', { name: 'Activer la double authentification' }).click();
  const secret = (await (await setup).json()).secret;
  await admin.getByLabel('Code à 6 chiffres').fill(totp(secret));
  await admin.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await admin.getByText('Double authentification active', { exact: true }).waitFor();
  const grant = spawnSync(python, ['-m', 'app.manage', 'grant-admin', users[2]], { env, encoding: 'utf8' });
  assert.equal(grant.status, 0, grant.stderr);
  await admin.getByRole('button', { name: 'Verrouiller', exact: true }).click();
  await login(admin, users[2], secret);
  await admin.getByRole('button', { name: 'Administration', exact: true }).click();
  await admin.locator('tr').filter({ hasText: users[0] }).getByRole('button', { name: 'Désactiver' }).click();
  await admin.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await admin.locator('tr').filter({ hasText: users[0] }).getByRole('button', { name: 'Réactiver', exact: true }).waitFor();
  await alice.getByRole('button', { name: 'Télécharger', exact: true }).click();
  await alice.getByRole('heading', { name: 'Ouvrir le coffre' }).waitFor();
  await admin.locator('tr').filter({ hasText: users[0] }).getByRole('button', { name: 'Réactiver' }).click();
  await admin.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await admin.locator('tr').filter({ hasText: users[0] }).getByRole('button', { name: 'Désactiver', exact: true }).waitFor();
  assert(requestBodies.length > 0);
  for (const body of requestBodies) {
    assert(!body.includes(password)); assert(!body.includes(fileName)); assert(!body.includes(fileClear));
  }
  assert.deepEqual(await bob.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })), { local: [], session: [] });
  assert.deepEqual(errors, []);
  await bob.setViewportSize({ width: 390, height: 844 });
  assert(await bob.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'Mobile overflow');
  await bob.setViewportSize({ width: 1280, height: 720 });
  await admin.screenshot({ path: path.join(tmpdir(), 'gestionnaire-admin.png'), fullPage: true });
  await bob.screenshot({ path: path.join(tmpdir(), 'gestionnaire-files.png'), fullPage: true });
  console.log('Browser acceptance passed: registration, dashboard, encrypted upload, verified sharing, download, RSA restore, revocation, admin MFA, suspension/reactivation, network secrecy and empty web storage.');
} finally {
  await browser?.close(); server.kill();
  await rm(database, { force: true });
}
