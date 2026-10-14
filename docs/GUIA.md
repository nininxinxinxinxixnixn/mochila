# Mochila 0.3.0 — preparar y descargar contexto

1. Cerrá la Mochila anterior desde × o Salir de la bandeja. Extraé `Mochila-Windows-0.3.0.zip` en otra carpeta y abrí el nuevo `Mochila.exe`. Inicia minimizada y pausada; usa la misma carpeta de datos.
2. Para moverla, arrastrá directamente el cuerpo del personaje. Clic sin arrastrar sigue abriendo/cerrando el cierre. ↓ inicia descarga automática; ☰ abre el menú.
3. Abrí el cierre, copiá un texto y dos capturas de prueba. Esperá el contador/fin de guardado. Desde ☰ podés reordenar y quitar con ×. Quitados y Recuperar permiten volver atrás; no se borran originales. ↶ o Ctrl+Z dentro del panel deshacen el último ingreso.
4. Elegí **Preparar MegaPrompt**. Junta los textos completos en `000-MegaPrompt.md` y crea copias independientes de los adjuntos, numeradas en el orden de la mochila. Preparar no vacía la cola. Si cambiás contenido/orden/freno, prepará de nuevo cuando el botón quede deshabilitado.
5. Elegí **Descargar MegaPrompt** y, durante los 3 segundos de cuenta regresiva, hacé clic en el cuadro del chat receptor. Se pega una sola lista de archivos: documento de texto + imágenes/PDF/audio/video que hayas incluido. No se pulsa Enter ni se envía el mensaje. El chat debe aceptar esos archivos y cantidades. Esc cancela/pausa.

**Descargar cola** es la alternativa que pega automáticamente uno por uno, con 750 ms entre intentos. También tiene 3 segundos para elegir el destino y Esc para frenar. **Ctrl+V de a uno** conserva el modo manual; soltá V entre pulsaciones. El primer destino se mantiene; cambiar de ventana pausa. Cambios entre pestañas del mismo navegador aún requieren cuidado: no se identifica cada cuadro de texto.

Los textos de una megacarga van en el archivo .md adjunto. Para texto inline, usá descarga de cola o Ctrl+V de a uno. Preparar mueve el trabajo de disco a una fase previa; la subida/lectura del chat todavía puede tardar. No se promete tiempo instantáneo universal.

El historial registra intentos, no recepción confirmada. Si el destino rechaza algo, revisá el historial y devolvé los intentos necesarios a la cola; no repetir automáticamente un resultado desconocido. Ctrl+Z del chat depende del chat. Mochila no elimina adjuntos ajenos por su cuenta.

Datos locales: `%APPDATA%\Mochila`; preparados en `prepared`. No se suben desde la app. Candidato de desarrollo sin firma. Prueba real de esta versión y aceptación humana pendientes; las pruebas automatizadas de entrega usaron un destino simulado.
