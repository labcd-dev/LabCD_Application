FROM python:3.11-slim

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        -o Acquire::Retries=5 \
        -o Acquire::http::Timeout=120 \
        -o Acquire::https::Timeout=120 \
        graphviz \
        octave \
    && rm -rf /var/lib/apt/lists/*

# XeLaTeX for Adaptive PDFs (same set as Dockerfile.api).
RUN apt-get update && \
    apt-get install -y --no-install-recommends --fix-missing \
        -o Acquire::Retries=5 \
        -o Acquire::http::Timeout=120 \
        -o Acquire::https::Timeout=120 \
        texlive-xetex \
        texlive-latex-recommended \
        texlive-latex-extra \
        texlive-fonts-recommended \
        texlive-science \
        fonts-lmodern \
    && rm -rf /var/lib/apt/lists/* \
    && which xelatex

COPY requirements.txt .

RUN python -m pip install --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8501

# Legacy Streamlit UI (prefer docker-compose for the FastAPI + React stack)
CMD ["streamlit", "run", "frontend_streamlit/home_page.py", "--server.port=8501", "--server.address=0.0.0.0"]
