# ISCF Node.js Backend

A minimal Express.js backend starter.

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env` and set a strong `JWT_SECRET`.

## Run

```bash
npm run dev
```

The server will start on `http://localhost:5000` by default.

## API Endpoints

- `GET /api/health` - Health check
- `POST /api/auth/register` - Register a user
- `POST /api/auth/login` - Login and receive a JWT
- `GET /api/auth/me` - Verify JWT

## Notes

- This is a JavaScript starter. If you want TypeScript, let me know and I can convert it.
- The user store is in-memory for demo purposes. For production, connect a database.
