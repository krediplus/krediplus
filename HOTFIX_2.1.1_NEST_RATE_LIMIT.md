# Kredi+ Backend Mobile 2.1.1

Corrección de compilación para NestJS 11.

El backend 2.1.0 importaba `TooManyRequestsException` desde `@nestjs/common`, símbolo que no está exportado por la versión instalada.
Se reemplazó por `HttpException` + `HttpStatus.TOO_MANY_REQUESTS`, manteniendo exactamente la respuesta HTTP 429 del rate limiter de autenticación.

No se desactiva el rate limiting y no se reintroduce reCAPTCHA.
