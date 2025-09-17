const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;

// Beyaz alan tespit fonksiyonu
function findWhitespaceBounds(data, info) {
  const { width, height, channels } = info;
  
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let hasContent = false;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      
      // Beyaz değilse (tolerance ile)
      if (r < 250 || g < 250 || b < 250) {
        hasContent = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  
  if (!hasContent) return null;
  
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

const app = express();
const PORT = process.env.PORT || 3000;

// Klasörleri oluştur
const dirs = ['uploads', 'processed', 'public'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Static files ve middleware
app.use(express.static('public'));
app.use(express.json());

// Multer config - dosya yükleme
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
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
        <title>🖼️ Auto Crop Whitespace Tool</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background: #f5f5f5;
            }
            .container {
                background: white;
                border-radius: 12px;
                padding: 30px;
                box-shadow: 0 2px 20px rgba(0,0,0,0.1);
            }
            h1 { color: #333; text-align: center; }
            .upload-area {
                border: 3px dashed #007cba;
                border-radius: 12px;
                padding: 40px;
                text-align: center;
                margin: 30px 0;
                background: #f8f9ff;
                transition: all 0.3s ease;
            }
            .upload-area:hover {
                background: #e8f4ff;
                border-color: #0056b3;
            }
            .upload-area.dragover {
                background: #e8f4ff;
                border-color: #0056b3;
                transform: scale(1.02);
            }
            input[type="file"] {
                display: none;
            }
            .btn {
                background: #007cba;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
                font-weight: 600;
                transition: all 0.3s ease;
                display: inline-block;
                text-decoration: none;
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
            .progress {
                display: none;
                width: 100%;
                height: 20px;
                background: #f0f0f0;
                border-radius: 10px;
                overflow: hidden;
                margin: 20px 0;
            }
            .progress-bar {
                height: 100%;
                background: linear-gradient(90deg, #007cba, #00a8ff);
                width: 0%;
                transition: width 0.3s ease;
                border-radius: 10px;
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
                align-items: center;
                padding: 10px;
                border-bottom: 1px solid #eee;
            }
            .file-item:last-child { border-bottom: none; }
            .status { font-weight: 600; }
            .success { color: #28a745; }
            .error { color: #dc3545; }
            .info {
                background: #e3f2fd;
                border: 1px solid #2196f3;
                border-radius: 8px;
                padding: 15px;
                margin: 20px 0;
            }
            .feature {
                display: flex;
                align-items: center;
                margin: 10px 0;
            }
            .feature::before {
                content: "✅";
                margin-right: 10px;
                font-size: 18px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🖼️ Auto Crop Whitespace Tool</h1>
            
            <div class="info">
                <h3>🚀 Özellikler:</h3>
                <div class="feature">Otomatik beyaz alan kırpma</div>
                <div class="feature">Toplu işleme desteği</div>
                <div class="feature">ZIP olarak indirme</div>
                <div class="feature">JPG, PNG, GIF, WEBP desteği</div>
                <div class="feature">10MB'a kadar dosya yükleme</div>
            </div>

            <form id="uploadForm" enctype="multipart/form-data">
                <div class="upload-area" id="uploadArea">
                    <h3>📁 Resimlerinizi Buraya Sürükleyin</h3>
                    <p>veya dosya seçmek için tıklayın</p>
                    <input type="file" id="fileInput" name="images" multiple accept="image/*">
                    <button type="button" class="btn" onclick="document.getElementById('fileInput').click()">
                        📂 Dosya Seç
                    </button>
                </div>

                <button type="submit" class="btn" id="processBtn" disabled>
                    ⚡ İşleme Başla
                </button>
            </form>

            <div class="progress" id="progressContainer">
                <div class="progress-bar" id="progressBar"></div>
            </div>

            <div class="results" id="results"></div>
        </div>

        <script>
            const uploadArea = document.getElementById('uploadArea');
            const fileInput = document.getElementById('fileInput');
            const processBtn = document.getElementById('processBtn');
            const progressContainer = document.getElementById('progressContainer');
            const progressBar = document.getElementById('progressBar');
            const results = document.getElementById('results');

            // Drag & Drop
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                uploadArea.addEventListener(eventName, preventDefaults, false);
            });

            function preventDefaults(e) {
                e.preventDefault();
                e.stopPropagation();
            }

            ['dragenter', 'dragover'].forEach(eventName => {
                uploadArea.addEventListener(eventName, highlight, false);
            });

            ['dragleave', 'drop'].forEach(eventName => {
                uploadArea.addEventListener(eventName, unhighlight, false);
            });

            function highlight(e) {
                uploadArea.classList.add('dragover');
            }

            function unhighlight(e) {
                uploadArea.classList.remove('dragover');
            }

            uploadArea.addEventListener('drop', handleDrop, false);

            function handleDrop(e) {
                const dt = e.dataTransfer;
                const files = dt.files;
                fileInput.files = files;
                updateFileInfo(files);
            }

            fileInput.addEventListener('change', function() {
                updateFileInfo(this.files);
            });

            function updateFileInfo(files) {
                if (files.length > 0) {
                    uploadArea.innerHTML = '<h3>📎 ' + files.length + ' dosya seçildi</h3><p>İşleme başlamak için butona tıklayın</p>';
                    processBtn.disabled = false;
                } else {
                    processBtn.disabled = true;
                }
            }

            document.getElementById('uploadForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const files = fileInput.files;
                if (files.length === 0) return;

                const formData = new FormData();
                for (let file of files) {
                    formData.append('images', file);
                }

                processBtn.disabled = true;
                processBtn.textContent = '⏳ İşleniyor...';
                progressContainer.style.display = 'block';
                results.style.display = 'none';

                try {
                    const response = await fetch('/process', {
                        method: 'POST',
                        body: formData
                    });

                    const result = await response.json();
                    showResults(result);
                } catch (error) {
                    console.error('Hata:', error);
                    alert('Bir hata oluştu: ' + error.message);
                } finally {
                    processBtn.disabled = false;
                    processBtn.textContent = '⚡ İşleme Başla';
                    progressContainer.style.display = 'none';
                    progressBar.style.width = '0%';
                }
            });

            function showResults(result) {
                results.style.display = 'block';
                
                let html = '<h3>📊 İşlem Sonuçları</h3>';
                
                result.files.forEach(file => {
                    const statusClass = file.success ? 'success' : 'error';
                    const statusIcon = file.success ? '✅' : '❌';
                    html += '<div class="file-item"><span>' + statusIcon + ' ' + file.originalName + '</span><span class="status ' + statusClass + '">' + file.message + '</span></div>';
                });

                if (result.zipFile) {
                    html += '<div style="text-align: center; margin-top: 20px;"><a href="/download/' + result.zipFile + '" class="btn">📦 İşlenmiş Dosyaları İndir (ZIP)</a></div>';
                }

                results.innerHTML = html;
            }

            // Progress simulation
            let progressInterval;
            function startProgress() {
                let progress = 0;
                progressInterval = setInterval(() => {
                    progress += Math.random() * 15;
                    if (progress > 90) progress = 90;
                    progressBar.style.width = progress + '%';
                }, 500);
            }

            function completeProgress() {
                clearInterval(progressInterval);
                progressBar.style.width = '100%';
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                    progressBar.style.width = '0%';
                }, 1000);
            }
        </script>
    </body>
    </html>
  `);
});

// Dosya işleme endpoint
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
    // İşlenmiş dosyalar için benzersiz klasör
    const batchId = Date.now();
    const processedDir = path.join('processed', batchId.toString());
    fs.mkdirSync(processedDir, { recursive: true });

    // Her dosyayı işle
    for (const file of req.files) {
      try {
        const outputPath = path.join(processedDir, `cropped-${file.originalname}`);
        
        // Daha agresif kırpma algoritması
        const image = sharp(file.path);
        const metadata = await image.metadata();
        
        // Otomatik kırpma - beyaz alanları tespit et
        const processed = await image
          .trim({
            background: { r: 255, g: 255, b: 255, alpha: 1 },
            threshold: 20
          })
          .toFile(outputPath);
        
        // Eğer trim çalışmadıysa manuel kırpma dene
        if (processed.width === metadata.width && processed.height === metadata.height) {
          // Manuel beyaz alan tespiti
          const { data, info } = await sharp(file.path)
            .raw()
            .toBuffer({ resolveWithObject: true });
          
          const bounds = findWhitespaceBounds(data, info);
          
          if (bounds) {
            await sharp(file.path)
              .extract({
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height
              })
              .toFile(outputPath);
          } else {
            // Son çare: orijinal dosyayı kopyala
            await sharp(file.path).toFile(outputPath);
          }
        }

        results.files.push({
          originalName: file.originalname,
          processedName: `cropped-${file.originalname}`,
          success: true,
          message: 'Başarıyla işlendi'
        });
        
        results.success++;
        
        // Geçici dosyayı sil
        fs.unlinkSync(file.path);
        
      } catch (error) {
        console.error('Dosya işleme hatası:', error);
        results.files.push({
          originalName: file.originalname,
          success: false,
          message: 'İşlem hatası: ' + error.message
        });
        results.error++;
        
        // Hatalı dosyayı da sil
        try { fs.unlinkSync(file.path); } catch {}
      }
    }

    // ZIP dosyası oluştur
    if (results.success > 0) {
      const zipPath = path.join('processed', `cropped-images-${batchId}.zip`);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.pipe(output);
      archive.directory(processedDir, false);
      await archive.finalize();

      results.zipFile = `cropped-images-${batchId}.zip`;
    }

    res.json(results);

  } catch (error) {
    console.error('Genel işlem hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası: ' + error.message });
  }
});

// ZIP indirme
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join('processed', filename);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath, filename, (err) => {
      if (!err) {
        // İndirme tamamlandıktan sonra dosyaları temizle
        setTimeout(() => {
          try {
            fs.unlinkSync(filePath);
            const batchId = filename.replace('cropped-images-', '').replace('.zip', '');
            const processedDir = path.join('processed', batchId);
            if (fs.existsSync(processedDir)) {
              fs.rmSync(processedDir, { recursive: true, force: true });
            }
          } catch (cleanupError) {
            console.error('Temizleme hatası:', cleanupError);
          }
        }, 30000); // 30 saniye sonra temizle
      }
    });
  } else {
    res.status(404).json({ error: 'Dosya bulunamadı' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log('📁 Upload directory ready');
  console.log('⚡ Auto-crop service active');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Server shutting down...');
  process.exit(0);
});
