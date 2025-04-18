# ───────────────────────────────────────────────
# 🧪 Noona-Oracle (Python 3.12 + AI)
# ───────────────────────────────────────────────
FROM python:3.12-slim AS noona-oracle

WORKDIR /noona/oracle

# Install Python dependencies
COPY ../services/oracle/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy application code
COPY ../services/oracle ./

CMD ["python", "initmain.py"]
