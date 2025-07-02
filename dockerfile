FROM node:20

RUN apt-get update && apt-get install -y \
    poppler-utils \
    imagemagick \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

RUN sed -i 's/<policy domain="coder" rights="none" pattern="PDF" \/>/<policy domain="coder" rights="read|write" pattern="PDF" \/>/g' /etc/ImageMagick-6/policy.xml

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p /tmp && chmod 777 /tmp

# アプリケーションを起動
CMD ["npm", "start"]