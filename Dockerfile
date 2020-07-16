FROM node:lts-alpine

# Labels for GitHub to read your action
LABEL "com.github.actions.name"="github-activity-readme"
LABEL "com.github.actions.description"="Updates README with the recent GitHub activity of a user"

RUN apk add --no-cache git

# Copy the package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of your action's code
COPY . .

# Run `node /index.js`
ENTRYPOINT ["node", "/index.js"]
