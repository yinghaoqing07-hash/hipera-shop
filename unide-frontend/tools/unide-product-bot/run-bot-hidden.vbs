' Arranca start-bot.cmd SIN ventana (estilo 0 = oculto).
' Pensado para llamarse YA ELEVADO: desde la tarea programada
' UnideProductBot (que corre con privilegios altos) o desde panel.cmd,
' que eleva wscript con UAC antes de llamar aqui. Si se lanzara sin
' elevar, start-bot.cmd se relanzaria pidiendo UAC en una ventana visible.
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = carpeta
sh.Run """" & carpeta & "\start-bot.cmd""", 0, False
