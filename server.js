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

// İşlem durumlarını takip etmek için memory store
const processingJobs = new Map();

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

// Ana sayfa (önceki gibi)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🖼️ Auto Crop Tool - Fal AI Integration</title>
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
            .api-info {
                background: #e8f5e8;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
                border-left: 4px solid #4caf50;
            }
            .endpoint {
                background: #f8f9fa;
                padding: 15px;
                border-radius: 8px;
                margin: 10px 0;
                font-family: monospace;
                border-left: 3px solid #007cba;
            }
            code {
                background: #f1f1f1;
                padding: 2px 6px;
                border-radius: 4px;
                font-family: monospace;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 Fal AI Auto Crop Service</h1>
            
            <div class="api-info">
                <h3>🔗 n8n Entegrasyon API'leri</h3>
                <p><strong>Bu servis n8n workflow'ları için tasarlanmıştır.</strong></p>
            </div>

            <div class="endpoint">
                <h4>📤 1. İşlem Başlatma</h4>
                <p><strong>POST</strong> <code>/api/fal/process</code></p>
                <p>Body: <code>{"imageUrl": "https://v3b.fal.media/files/..."}</code></p>
                <p>↳ Döner: <code>{"jobId": "12345", "status": "processing"}</code></p>
            </div>

            <div class="endpoint">
                <h4>📥 2. Sonuç Alma</h4>
                <p><strong>GET</strong> <code>/api/fal/result/:jobId</code></p>
                <p>↳ Döner: <code>{"status": "completed", "croppedUrl": "..."}</code></p>
            </div>

            <div class="endpoint">
                <h4>⚡ 3. Tek Seferde İşlem</h4>
                <p><strong>POST</strong> <code>/api/fal/crop-sync</code></p>
                <p>Body: <code>{"imageUrl": "https://v3b.fal.media/files/..."}</code></p>
                <p>↳ Döner: <code>{"croppedUrl": "...", "originalUrl": "..."}</code></p>
            </div>

            <p style="text-align: center; margin-top: 30px;">
                <strong>Service Status:</strong> 
                <span style="color: #4caf50;">🟢 Active</span>
            </p>
        </div>
    </body>
    </html>
  `);
});

// 1. Fal AI URL'inden resim işleme başlatma (async)
app.post('/api/fal/process', async (req, res) => {
  const { imageUrl } = req.body;
  
  if (!imageUrl) {
    return res.status(400).json({ 
      error: 'Missing imageUrl',
      message: 'Please provide imageUrl in request body'
    });
  }

  try {
    const jobId = Date.now().toString();
    
    // İşlem durumunu kaydet
    processingJobs.set(jobId, {
      status: 'processing',
      imageUrl: imageUrl,
      startedAt: new Date().toISOString(),
      progress: 0
    });

    // Async işlemi başlat
    processImageAsync(jobId, imageUrl);

    res.json({
      jobId: jobId,
      status: 'processing',
      message: 'Image processing started',
      estimatedTime: '3-5 seconds',
      checkUrl: `/api/fal/result/${jobId}`
    });

  } catch (error) {
    console.error('[FAL] Process error:', error);
    res.status(500).json({ 
      error: 'Processing failed',
      message: error.message 
    });
  }
});

// 2. İşlem sonucunu kontrol etme
app.get('/api/fal/result/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  const job = processingJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({
      error: 'Job not found',
      message: 'Invalid or expired job ID'
    });
  }

  res.json({
    jobId: jobId,
    status: job.status,
    ...(job.status === 'completed' && {
      croppedUrl: job.croppedUrl,
      originalUrl: job.imageUrl,
      processedAt: job.completedAt,
      fileSize: job.fileSize
    }),
    ...(job.status === 'error' && {
      error: job.error
    }),
    ...(job.status === 'processing' && {
      progress: job.progress,
      message: 'Still processing...'
    })
  });
});

// 3. Tek seferde senkron işlem (n8n için daha basit)
app.post('/api/fal/crop-sync', async (req, res) => {
  const { imageUrl } = req.body;
  
  if (!imageUrl) {
    return res.status(400).json({ 
      error: 'Missing imageUrl',
      message: 'Please provide imageUrl in request body'
    });
  }

  try {
    console.log(`[FAL-SYNC] Processing: ${imageUrl}`);
    
    // URL'den resmi indir
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: HTTP ${response.status}`);
    }
    
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const fileName = `fal-${Date.now()}.png`;
    const outputPath = path.join('processed', `cropped-${fileName}`);
    
    // Resmi kırp
    const processedImage = await sharp(imageBuffer)
      .trim({
        background: { r: 255, g: 255, b: 255, alpha: 1 },
        threshold: 25
      })
      .png()
      .toFile(outputPath);
    
    // URL oluştur
    const baseUrl = req.protocol + '://' + req.get('host');
    const croppedUrl = `${baseUrl}/processed/cropped-${fileName}`;
    
    console.log(`[FAL-SYNC] Completed: ${croppedUrl}`);
    
    res.json({
      status: 'completed',
      originalUrl: imageUrl,
      croppedUrl: croppedUrl,
      fileName: `cropped-${fileName}`,
      fileSize: processedImage.size,
      processedAt: new Date().toISOString()
    });

    // 30 dakika sonra dosyayı temizle
    setTimeout(() => {
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
          console.log(`[CLEANUP] Deleted: ${outputPath}`);
        }
      } catch (err) {
        console.error('[CLEANUP] Error:', err);
      }
    }, 30 * 60 * 1000);

  } catch (error) {
    console.error('[FAL-SYNC] Error:', error);
    res.status(500).json({ 
      status: 'error',
      error: error.message,
      originalUrl: imageUrl
    });
  }
});

// Async işlem fonksiyonu
async function processImageAsync(jobId, imageUrl) {
  try {
    // Progress güncelle
    const job = processingJobs.get(jobId);
    job.progress = 25;
    
    // URL'den resmi indir
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status}`);
    }
    
    job.progress = 50;
    
    const imageBuffer = await response.buffer();
    const fileName = `fal-async-${jobId}.png`;
    const outputPath = path.join('processed', `cropped-${fileName}`);
    
    job.progress = 75;
    
    // Resmi kırp
    const processedImage = await sharp(imageBuffer)
      .trim({
        background: { r: 255, g: 255, b: 255, alpha: 1 },
        threshold: 25
      })
      .png()
      .toFile(outputPath);
    
    // İşlem tamamlandı
    job.status = 'completed';
    job.progress = 100;
    job.croppedUrl = `${process.env.RAILWAY_STATIC_URL || 'http://localhost:3000'}/processed/cropped-${fileName}`;
    job.completedAt = new Date().toISOString();
    job.fileSize = processedImage.size;
    
    console.log(`[FAL-ASYNC] Job ${jobId} completed: ${job.croppedUrl}`);
    
    // 1 saat sonra job'ı temizle
    setTimeout(() => {
      processingJobs.delete(jobId);
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      } catch (err) {
        console.error('[CLEANUP] Error:', err);
      }
    }, 60 * 60 * 1000);
    
  } catch (error) {
    console.error(`[FAL-ASYNC] Job ${jobId} failed:`, error);
    
    const job = processingJobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = error.message;
      job.completedAt = new Date().toISOString();
    }
  }
}

// İşlenmiş dosyaları serve et
app.use('/processed', express.static('processed'));

// Mevcut crop endpoint'leri (önceki gibi)
app.post('/process', upload.array('images', 50), async (req, res) => {
  // ... (önceki kod aynı)
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Fal AI Auto Crop Service',
    timestamp: new Date().toISOString(),
    activeJobs: processingJobs.size,
    endpoints: {
      falProcess: 'POST /api/fal/process',
      falResult: 'GET /api/fal/result/:jobId',
      falCropSync: 'POST /api/fal/crop-sync',
      health: 'GET /api/health'
    }
  });
});

// Sunucu başlat
app.listen(PORT, () => {
  console.log(`🚀 Fal AI Crop Service running on port ${PORT}`);
  console.log('🤖 Ready for n8n integration');
  console.log('🔗 API endpoints active');
});
