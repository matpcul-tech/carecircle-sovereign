# Shared proxy settings for every upstream location.
# (nginx forwards client request headers - Authorization, apikey, Prefer,
# Content-Type - to the upstream automatically; we only override Host and add
# forwarding context.)
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Connection "";
proxy_read_timeout 75s;
proxy_send_timeout 75s;
