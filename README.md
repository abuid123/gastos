# Gasto diario

App web instalable para saber **cuánto podés gastar hoy**. Cargás la plata del período (por ejemplo $1.560.000 para el mes), anotás cada gasto y la app divide lo que queda por día. Si un día te sobra, se suma a lo que tenés al día siguiente; si te pasás, se resta.

Cada persona que la abre tiene **su propia base de datos SQLite**, guardada en su dispositivo. No hay servidor, cuentas ni login: el link es el mismo para todos y los datos no se cruzan.

## Instalarla

**iPhone / iPad**
1. Abrí el link en Safari.
2. Tocá Compartir y después **Agregar a pantalla de inicio**.
3. Usala siempre desde el ícono. La app instalada guarda sus datos aparte de Safari: lo que anotes en Safari no aparece en la app.

**Mac**
- Safari: menú **Archivo → Agregar al Dock**.
- Chrome: botón de instalar en la barra de direcciones, o el botón **Instalar** que muestra la app.

Una vez instalada, funciona sin internet.

## Qué hace

- Cifra del día: base diaria + lo que arrastrás (o te comiste) de días anteriores.
- Dos modos: lo que sobra o falta pasa entero a mañana, o se reparte entre los días que quedan.
- Gastos fijos (alquiler, cuotas) que se reparten entre los días restantes en vez de comerse un día.
- Gráfico día por día, gastos por categoría, promedio y proyección al cierre.
- Montos como `4500`, `4.500,50` o `15k`.
- Deshacer al anotar, borrar o importar.
- Períodos nuevos, con la opción de sumar lo que sobró.

## Tus datos y el backup

Los datos viven **solo en el dispositivo** (IndexedDB del navegador). No se sincronizan entre el iPhone y la Mac. Si borrás la app o los datos del navegador, se pierden.

Desde **Ajustes → Backup**:
- **Bajar backup (.sqlite)**: el archivo completo de la base. Guardalo en iCloud, Drive o mandátelo por mail. Lo abrís con DB Browser for SQLite, DBeaver o `sqlite3`.
- **Bajar CSV**: para Excel o Google Sheets (separado por punto y coma).
- **Importar backup**: acepta el `.sqlite` de esta app o el `.zip` que baja la versión hecha en Claude.

Si pasan 14 días sin backup, la app te lo recuerda.

### Esquema

```sql
periodo (id, monto, desde, hasta, modo, creado)   -- monto en centavos; modo: 'arrastre' | 'reparto'
gasto   (id, fecha, monto, categoria, nota, fijo, creado)
```

## Cómo está hecha

HTML, CSS y JavaScript sin frameworks ni build. SQLite corre en el navegador con [sql.js](https://github.com/sql-js/sql.js) (WebAssembly), y un service worker guarda la app para que abra sin conexión. Las fuentes (Archivo, Instrument Sans, DM Mono) están incluidas en el repo. Las licencias de terceros están en `LICENCIAS.txt`.

| Archivo | Qué es |
|---|---|
| `index.html`, `styles.css`, `app.js` | La app |
| `sw.js` | Service worker (modo sin conexión) |
| `manifest.webmanifest`, `icon*.png`, `icon.svg` | Datos para instalarla |
| `sql-wasm.js`, `sql-wasm.wasm` | SQLite compilado a WebAssembly |

### Publicar cambios

Está publicada con GitHub Pages desde la rama `main`. Cuando cambies cualquier archivo, **subí `VERSION` en `sw.js`** (`v1` → `v2`): así los teléfonos que ya la tienen instalada bajan la versión nueva y les aparece "Hay una versión nueva de la app".

Para probarla en tu máquina: `python3 -m http.server 8000` y abrí http://localhost:8000.
