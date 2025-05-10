FROM node:20

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm i
RUN npm ci

COPY . .

CMD ["npm", "start"]