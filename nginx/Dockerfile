FROM nginx:alpine

# 复制 nginx 配置
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# 复制前端静态文件
COPY 报价计算器.html /usr/share/nginx/html/
COPY quote-calculator.js /usr/share/nginx/html/
COPY quote-calculator.css /usr/share/nginx/html/

# Hardening: 删除默认站点
RUN rm -f /etc/nginx/conf.d/default.conf.bak

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
