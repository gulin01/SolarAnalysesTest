.PHONY: dev prod down logs ps clean migrate seed

# ── Development ──────────────────────────────────────────────────────────────
dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up

dev-build:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

down:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# ── Production ───────────────────────────────────────────────────────────────
prod:
	docker compose up -d

prod-build:
	docker compose up -d --build

# ── Database ─────────────────────────────────────────────────────────────────
migrate:
	docker compose exec backend alembic upgrade head

migrate-create:
	docker compose exec backend alembic revision --autogenerate -m "$(msg)"

# ── Utilities ────────────────────────────────────────────────────────────────
logs:
	docker compose logs -f

ps:
	docker compose ps

clean:
	docker compose down -v --remove-orphans
	docker system prune -f
