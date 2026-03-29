FROM nginx:1.27-alpine

# on remplace la conf nginx par la nôtre
COPY --chown=nginx:nginx nginx.conf        /etc/nginx/nginx.conf
COPY --chown=nginx:nginx index.html app.js /usr/share/nginx/html/

RUN mkdir -p /tmp \
 && chown -R nginx:nginx /var/cache/nginx /var/log/nginx

USER nginx
EXPOSE 8080
