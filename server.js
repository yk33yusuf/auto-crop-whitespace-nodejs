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
app.use(express.json({ limit: '50mb' }));

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

// n8n'den gelen veri formatı için özel endpoint
app.post('/api/n8n-crop', async (req, res) => {
  console.log('🎯 n8n request received:', JSON.stringify(req.body, null, 2));
  
  const inputData = req.body;
  
  // Veriyi normalize et - hem array hem tek obje destekle
  let images = [];
  
  if (Array.isArray(inputData)) {
    images = inputData;
  } else if (inputData.image && inputData.image.url) {
    images = [inputData];
  } else if (inputData.images && Array.isArray(inputData.images)) {
    images = inputData.images;
  } else {
    return res.status(400).json({
      error: 'Invalid data format',
      message: 'Expected array of objects with image.url property',
      received: typeof inputData,
      example: [{ "image": { "url": "https://example.com/image.jpg" } }]
    });
  }

  if (images.length === 0) {
    return res.status(400).json({
      error: 'No images provided',
      message: 'Please provide at least one image with URL'
    });
  }

  try {
    const batchId = Date.now();
    const processedDir = path.join('processed', batchId.toString());
    fs.mkdirSync(processedDir, { recursive: true });

    console.log(`📁 Processing ${images.length} images for batch ${batchId}`);

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    // Her resmi işle
    for (let i = 0; i < images.length; i++) {
      const imageData = images[i];
      const imageUrl = imageData.image?.url;
      
      if (!imageUrl) {
        console.log(`❌ No URL found for image ${i + 1}`);
        results.push({
          index: i + 1,
          success: false,
          error: 'No URL provided',
          originalUrl: null,
          processedUrl: null
        });
        errorCount++;
        continue;
      }

      try {
        console.log(`🔄 Processing image ${i + 1}: ${imageUrl}`);
        
        // URL'den resmi indir
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const imageBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(imageBuffer);
        
        // Dosya uzantısını tahmin et
        const urlParts = imageUrl.split('.');
        const extension = urlParts[urlParts.length - 1].split('?')[0] || 'jpg';
        const filename = `image-${i + 1}-${batchId}.${extension}`;
        const outputPath = path.join(processedDir, filename);
        
        // Resmi kırp ve kaydet
        const metadata = await sharp(buffer).metadata();
        console.log(`📐 Original size: ${metadata.width}x${metadata.height}`);
        
        await sharp(buffer)
          .trim({
            background: { r: 255, g: 255, b: 255, alpha: 1 },
            threshold: 25
          })
          .png() // PNG olarak kaydet (kalite için)
          .toFile(outputPath);
        
        const processedMetadata = await sharp(outputPath).metadata();
        console.log(`✂️ Cropped size: ${processedMetadata.width}x${processedMetadata.height}`);
        
        // İşlenmiş dosya için URL oluştur
        const baseUrl = req.protocol + '://' + req.get('host');
        const processedUrl = `${baseUrl}/processed/${batchId}/${filename}`;
        
        results.push({
          index: i + 1,
          success: true,
          originalUrl: imageUrl,
          processedUrl: processedUrl,
          originalSize: {
            width: metadata.width,
            height: metadata.height
          },
          croppedSize: {
            width: processedMetadata.width,
            height: processedMetadata.height
          },
          filename: filename
        });
        
        successCount++;
        console.log(`✅ Successfully processed image ${i + 1}`);
        
      } catch (error) {
        console.error(`❌ Error processing image ${i + 1}:`, error.message);
        
        results.push({
          index: i + 1,
          success: false,
          error: error.message,
          originalUrl: imageUrl,
          processedUrl: null
        });
        
        errorCount++;
      }
    }

    // n8n için response
    const response = {
      status: 'completed',
      batchId: batchId,
      processedAt: new Date().toISOString(),
      summary: {
        total: images.length,
        successful: successCount,
        failed: errorCount
      },
      results: results,
      // İlk başarılı sonucun URL'ini ana alan olarak döndür (tek resim işleme için)
      processedUrl: results.find(r => r.success)?.processedUrl || null
    };

    console.log('🎉 Processing completed:', {
      total: images.length,
      successful: successCount,
      failed: errorCount
    });

    res.json(response);

  } catch (error) {
    console.error('💥 Processing error:', error);
    res.status(500).json({
      status: 'error',
      error: error.message,
      processedAt: new Date().toISOString()
    });
  }
});

// İşlenmiş dosyaları serve et
app.get('/processed/:batchId/:filename', (req, res) => {
  const { batchId, filename } = req.params;
  const filePath = path.join('processed', batchId, filename);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(path.resolve(filePath));
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Test endpoint
app.post('/api/test', (req, res) => {
  console.log('Test request body:', req.body);
  res.json({
    received: req.body,
    timestamp: new Date().toISOString(),
    message: 'Test successful'
  });
});

// Ana sayfa (mevcut)
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
            .endpoint {
                background: #f8f9fa;
                border: 1px solid #dee2e6;
                border-radius: 8px;
                padding: 15px;
                margin: 15px 0;
                font-family: monospace;
            }
            .method { 
                background: #007cba; 
                color: white; 
                padding: 4px 8px; 
                border-radius: 4px; 
                font-size: 12px; 
                font-weight: bold; 
            }
            .url { color: #28a745; font-weight: bold; }
            pre { 
                background: #f1f3f4; 
                padding: 10px; 
                border-radius: 4px; 
                overflow-x: auto; 
                font-size: 12px;
            }
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
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🖼️ Auto Crop Tool + n8n API</h1>
            
            <h3>🔌 API Endpoints</h3>
            
            <div class="endpoint">
                <span class="method">POST</span> 
                <span class="url">/api/n8n-crop</span>
                <p><strong>n8n için özel endpoint</strong></p>
                <pre>{
  "image": {
    "url": "https://example.com/image.jpg",
    "content_type": "image/png",
    "width": 1024,
    "height": 1024
  }
}</pre>
            </div>

            <div class="endpoint">
                <span class="method">GET</span> 
                <span class="url">/processed/:batchId/:filename</span>
                <p><strong>İşlenmiş dosya erişimi</strong></p>
            </div>

            <h3>🧪 Manual Test</h3>
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
                
                if (result.files) {
                    result.files.forEach(file => {
                        const statusClass = file.success ? 'success' : 'error';
                        const icon = file.success ? '✅' : '❌';
                        html += '<div style="padding: 10px; border-bottom: 1px solid #eee;">';
                        html += '<span>' + icon + ' ' + file.originalName + '</span>';
                        html += '</div>';
                    });
                }

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

// Mevcut upload endpoint (web arayüzü için)
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

    for (const file of req.files) {
      try {
        const outputPath = path.join(processedDir, `cropped-${file.originalname}`);
        
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
        fs.unlinkSync(file.path);
        
      } catch (error) {
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

    if (results.success > 0) {
      const zipFilename = `images-${batchId}.zip`;
      const zipPath = path.join('processed', zipFilename);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip');

      archive.pipe(output);
      archive.directory(processedDir, false);
      await archive.finalize();

      results.zipFile = zipFilename;
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Auto Crop API for n8n',
    timestamp: new Date().toISOString(),
    endpoints: {
      n8nCrop: '/api/n8n-crop (POST)',
      health: '/api/health (GET)',
      processedFiles: '/processed/:batchId/:filename (GET)'
    }
  });
});

// Sunucu başlat
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 n8n endpoint: /api/n8n-crop`);
  console.log(`🏥 Health check: /api/health`);
});
