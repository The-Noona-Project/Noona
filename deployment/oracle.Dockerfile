# 🧠 Noona-Oracle Dockerfile (Python AI Service)
# Location: deployment/single/oracle.Dockerfile

FROM python:3.12-slim AS noona-oracle

WORKDIR /noona/services/oracle

# Install Python deps
COPY services/oracle/requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy project files
COPY services/oracle ./
CMD ["python3", "initmain.py"]
