param([string]$src, [int]$x, [int]$y, [int]$w, [int]$h, [string]$out)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile((Resolve-Path $src))
$crop = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($crop)
$g.DrawImage($img, (New-Object System.Drawing.Rectangle(0,0,$w,$h)), (New-Object System.Drawing.Rectangle($x,$y,$w,$h)), [System.Drawing.GraphicsUnit]::Pixel)
$crop.Save((Join-Path (Get-Location) $out))
$g.Dispose(); $crop.Dispose(); $img.Dispose()
Write-Output "cropped $out ($w x $h)"
