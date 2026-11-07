FROM mongo:7.0

COPY infra/product-mongo/entrypoint.sh /usr/local/bin/product-mongo-entrypoint.sh

RUN sed -i 's/\r$//' /usr/local/bin/product-mongo-entrypoint.sh \
    && chmod 755 /usr/local/bin/product-mongo-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/product-mongo-entrypoint.sh"]

CMD ["mongod", "--replSet", "product-rs", "--bind_ip_all", "--keyFile", "/etc/mongo-keyfile/keyfile"]