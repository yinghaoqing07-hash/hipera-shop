' Abre el panel sin ensenar NINGUNA consola: corre panel.cmd oculto
' (el se encarga de arrancar el bot si hace falta y de abrir la ventana
' app de Edge). Para ver los mensajes de arranque o errores, ejecutar
' panel.cmd o start-bot.cmd directamente.
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = carpeta
sh.Run """" & carpeta & "\panel.cmd""", 0, False
