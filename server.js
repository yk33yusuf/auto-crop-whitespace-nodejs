const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;

// Klasörleri oluştur
const dirs = ['uploads', 'processed', 'public'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = allowedTypes.test(file.mimetype);
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      cb(null, true);
    } else {
      cb(new Error('Desteklenen formatlar: JPG, PNG, GIF, WEBP'));
    }
  }
});

// Ana sayfa
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🖼️ Auto Crop Tool</title>
        <style>
            body {
                font-family: system-ui, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background: #f5f5f5;
            }
            .container {
                background: white;
                border-radius: 12px;
                padding: 30px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            }
            h1 { text-align: center; color: #333; }
            .upload-area {
                border: 3px dashed #007cba;
                border-radius: 12px;
                padding: 40px;
                text-align: center;
                margin: 30px 0;
                background: #f8f9ff;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            .upload-area:hover {
                background: #e8f4ff;
                transform: scale(1.02);
            }
            input[type="file"] { display: none; }
            .btn {
                background: #007cba;
                color: white;
                border: none;
                padding: 15px 30px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
                font-weight: 600;
                transition: all 0.3s ease;
            }
            .btn:hover {
                background: #0056b3;
                transform: translateY(-2px);
            }
            .btn:disabled {
                background: #ccc;
                cursor: not-allowed;
                transform: none;
            }
            .results {
                margin-top: 30px;
                padding: 20px;
                background: #f8f9fa;
                border-radius: 8px;
                display: none;
            }
            .file-item {
                display: flex;
                justify-content: space-between;
                padding: 10px;
                border-bottom: 1px solid #eee;
            }
            .success { color: #28a745; font-weight: bold; }
            .error { color: #dc3545; font-weight: bold; }
            .info {
                background: #e3f2fd;
                padding: 15px;
                border-radius: 8px;
                margin: 20px 0;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🖼️ Auto Crop Whitespace Tool</h1>
            
            <div class="info">
                <h3>✨ Nasıl Çalışır?</h3>
                <ul>
                    <li>Resimlerinizi seçin (JPG, PNG, GIF, WEBP)</li>
                    <li>Otomatik beyaz alan kırpma yapılır</li>
                    <li>ZIP dosyası olarak indirin</li>
                </ul>
            </div>

            <form id="uploadForm">
                <div class="upload-area" onclick="document.getElementById('fileInput').click()">
                    <h3>📁 Resimlerinizi Seçin</h3>
                    <p>Buraya tıklayın veya dosyaları sürükleyin</p>
                    <input type="file" id="fileInput" multiple accept="image/*">
                    <button type="button" class="btn">Dosya Seç</button>
                </div>

                <button type="submit" class="btn" id="processBtn" disabled>
                    ⚡ İşleme Başla
                </button>
            </form>

            <div class="results" id="results"></div>
        </div>

        <script>
            const fileInput = document.getElementById('fileInput');
            const processBtn = document.getElementById('processBtn');
            const results = document.getElementById('results');

            fileInput.addEventListener('change', function() {
                if (this.files.length > 0) {
                    document.querySelector('.upload-area h3').textContent = 
                        '📎 ' + this.files.length + ' dosya seçildi';
                    processBtn.disabled = false;
                }
            });

            document.getElementById('uploadForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                
                if (fileInput.files.length === 0) return;

                const formData = new FormData();
                for (let file of fileInput.files) {
                    formData.append('images', file);
                }

                processBtn.disabled = true;
                processBtn.textContent = '⏳ İşleniyor...';

                try {
                    const response = await fetch('/process', {
                        method: 'POST',
                        body: formData
                    });

                    const result = await response.json();
                    showResults(result);
                } catch (error) {
                    alert('Hata: ' + error.message);
                } finally {
                    processBtn.disabled = false;
                    processBtn.textContent = '⚡ İşleme Başla';
                }
            });

            function showResults(result) {
                results.style.display = 'block';
                
                let html = '<h3>📊 Sonuçlar</h3>';
                html += '<p>Başarılı: ' + result.success + ' | Hatalı: ' + result.error + '</p>';
                
                result.files.forEach(file => {
                    const statusClass = file.success ? 'success' : 'error';
                    const icon = file.success ? '✅' : '❌';
                    html += '<div class="file-item">';
                    html += '<span>' + icon + ' ' + file.originalName + '</span>';
                    html += '<span class="' + statusClass + '">' + file.message + '</span>';
                    html += '</div>';
                });

                if (result.zipFile) {
                    html += '<div style="text-align: center; margin-top: 20px;">';
                    html += '<a href="/download/' + result.zipFile + '" class="btn">📦 ZIP İndir</a>';
                    html += '</div>';
                }

                results.innerHTML = html;
            }
        </script>
    </body>
    </html>
  `);
});

// İşlem endpoint
app.post('/process', upload.array('images', 50), async (req, res) => {
  const results = {
    success: 0,
    error: 0,
    files: [],
    zipFile: null
  };

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Dosya yüklenmedi' });
  }

  try {
    const batchId = Date.now();
    const processedDir = path.join('processed', batchId.toString());
    fs.mkdirSync(processedDir, { recursive: true });

    console.log(`Processing ${req.files.length} files...`);

    for (const file of req.files) {
      try {
        const outputPath = path.join(processedDir, `cropped-${file.originalname}`);
        
        // Basit kırpma işlemi
        await sharp(file.path)
          .trim({
            background: { r: 255, g: 255, b: 255, alpha: 1 },
            threshold: 30
          })
          .toFile(outputPath);

        results.files.push({
          originalName: file.originalname,
          success: true,
          message: 'Kırpıldı'
        });
        
        results.success++;
        fs.unlinkSync(file.path); // Geçici dosyayı sil
        
      } catch (error) {
        console.error(`Error: ${file.originalname}:`, error.message);
        
        // Hata durumunda orijinali kopyala
        const outputPath = path.join(processedDir, `original-${file.originalname}`);
        fs.copyFileSync(file.path, outputPath);
        
        results.files.push({
          originalName: file.originalname,
          success: true,
          message: 'Orijinal kopyalandı'
        });
        
        results.success++;
        fs.unlinkSync(file.path);
      }
    }

    // ZIP oluştur
    if (results.success > 0) {
      const zipPath = path.join('processed', `images-${batchId}.zip`);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip');

      archive.pipe(output);
      archive.directory(processedDir, false);
      await archive.finalize();

      results.zipFile = `images-${batchId}.zip`;
    }

    res.json(results);

  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ZIP indirme
app.get('/download/:filename', (req, res) => {
  const filePath = path.join('processed', req.params.filename);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Dosya bulunamadı' });
  }
});

// Sunucu başlat
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
