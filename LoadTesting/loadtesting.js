import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { jUnit } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// =============================================
// CUSTOM METRICS - ENHANCED FOR VISUALIZATIONS
// =============================================
const errorRate = new Rate('errors');
const responseTimeTrend = new Trend('response_times');
const backendDistribution = new Counter('backend_requests');
const retryCounter = new Counter('retries');
const activeUsers = new Gauge('active_users');
const requestsPerSecond = new Rate('rps');
const responseTimeBuckets = new Counter('response_time_buckets');

// Store raw data for visualizations
let rawData = {
    requests: [],
    responseTimes: [],
    backends: [],
    retries: [],
    timestamps: [],
    userSessions: []
};

// =============================================
// TEST CONFIGURATION - FIXED FOR YOUR ENDPOINT
// =============================================
export const options = {
  // Progressive load stages
  stages: [
    // Warm-up
    { duration: '1m', target: 100 },
    { duration: '1m', target: 500 },
    { duration: '1m', target: 1000 },
    { duration: '2m', target: 1000 },
    
    // Medium load
    { duration: '2m', target: 3000 },
    { duration: '3m', target: 3000 },
    
    // High load
    { duration: '2m', target: 6000 },
    { duration: '3m', target: 6000 },
    
    // Very high load
    { duration: '2m', target: 10000 },
    { duration: '3m', target: 10000 },
    
    // Cool down
    { duration: '2m', target: 2000 },
    { duration: '1m', target: 0 },
  ],

  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.10'],
    errors: ['rate<0.08'],
  },

  discardResponseBodies: false, // Changed to false to capture response data
  systemTags: ['status', 'error', 'check'],
};

// =============================================
// FIXED CONFIGURATION - CORRECT ENDPOINT
// =============================================
const TEST_CONFIG = {
  ENDPOINT: 'https://localhost/get/messages',
  MAX_RETRIES: 2,
  REQUEST_TIMEOUT: '20s',
  MIN_SLEEP: 0.5,
  MAX_SLEEP: 2.0,
};

// =============================================
// CORE REQUEST FUNCTION - ENHANCED DATA COLLECTION
// =============================================
function makeRequest(userId, requestId) {
  const params = {
    timeout: TEST_CONFIG.REQUEST_TIMEOUT,
    insecureSkipTLSVerify: true,
    tags: { endpoint: 'root' }
  };

  let retryCount = 0;
  let startTime;
  const requestStartTime = Date.now();
  
  while (retryCount <= TEST_CONFIG.MAX_RETRIES) {
    startTime = Date.now();
    
    const response = http.get(TEST_CONFIG.ENDPOINT, params);
    const responseTime = Date.now() - startTime;
    
    requestsPerSecond.add(1);
    
    const success = check(response, {
      'status is 200': (r) => r.status === 200,
      'response received': (r) => r.status !== 0,
    });
    
    if (success) {
      const backend = response.headers['X-Backend-Server'] || 
                     response.headers['X-Server'] || 
                     response.headers['Server'] ||
                     'unknown';
      
      // Store raw data for visualizations
      const requestData = {
        timestamp: requestStartTime,
        userId: userId,
        requestId: requestId,
        backend: backend,
        responseTime: responseTime,
        status: response.status,
        retries: retryCount,
        success: true
      };
      
      rawData.requests.push(requestData);
      rawData.responseTimes.push(responseTime);
      rawData.backends.push(backend);
      rawData.retries.push(retryCount);
      rawData.timestamps.push(requestStartTime);
      
      backendDistribution.add(1, { backend: backend });
      responseTimeTrend.add(responseTime);
      
      // Categorize response time into buckets for histogram
      const bucket = getResponseTimeBucket(responseTime);
      responseTimeBuckets.add(1, { bucket: bucket });
      
      return {
        success: true,
        responseTime: responseTime,
        backend: backend,
        retries: retryCount,
        status: response.status
      };
    }
    
    retryCount++;
    retryCounter.add(1);
    
    if (retryCount <= TEST_CONFIG.MAX_RETRIES) {
      const backoffTime = Math.min(1000 * Math.pow(2, retryCount - 1), 2000);
      sleep(backoffTime / 1000);
    }
  }
  
  // Store failed request data
  const failedRequestData = {
    timestamp: requestStartTime,
    userId: userId,
    requestId: requestId,
    backend: 'error',
    responseTime: Date.now() - startTime,
    status: 'failed',
    retries: retryCount - 1,
    success: false
  };
  
  rawData.requests.push(failedRequestData);
  rawData.responseTimes.push(Date.now() - startTime);
  rawData.backends.push('error');
  rawData.retries.push(retryCount - 1);
  rawData.timestamps.push(requestStartTime);
  
  errorRate.add(1);
  return {
    success: false,
    responseTime: Date.now() - startTime,
    backend: 'error',
    retries: TEST_CONFIG.MAX_RETRIES,
    status: 'failed'
  };
}

function getResponseTimeBucket(responseTime) {
  if (responseTime < 100) return '0-100ms';
  if (responseTime < 200) return '100-200ms';
  if (responseTime < 500) return '200-500ms';
  if (responseTime < 1000) return '500-1000ms';
  if (responseTime < 2000) return '1000-2000ms';
  if (responseTime < 5000) return '2000-5000ms';
  return '5000ms+';
}

// =============================================
// MAIN TEST FUNCTION
// =============================================
export default function () {
  const userId = __VU; // Virtual User ID
  const requestId = __ITER; // Iteration number
  
  activeUsers.add(1);
  
  const thinkTime = Math.random() * (TEST_CONFIG.MAX_SLEEP - TEST_CONFIG.MIN_SLEEP) + TEST_CONFIG.MIN_SLEEP;
  sleep(thinkTime);
  
  const result = makeRequest(userId, requestId);
  
  if (Math.random() < 0.0005) {
    if (result.success) {
      console.log(`✅ ${result.backend} - ${result.responseTime}ms`);
    } else {
      console.log(`❌ Failed after ${result.retries} retries`);
    }
  }
  
  const browseTime = Math.random() * 1.5 + 0.5;
  sleep(browseTime);
  
  activeUsers.add(-1);
}

// =============================================
// ENHANCED RESULTS SUMMARY WITH VISUALIZATIONS
// =============================================
export function handleSummary(data) {
  const totalRequests = data.metrics.http_reqs.values.count;
  const failedRequests = data.metrics.http_req_failed.values.rate * totalRequests;
  const successRate = ((totalRequests - failedRequests) / totalRequests) * 100;
  const avgResponseTime = data.metrics.http_req_duration.values.avg;
  const p95ResponseTime = data.metrics.http_req_duration.values['p(95)'];
  const p99ResponseTime = data.metrics.http_req_duration.values['p(99)'];
  const maxVUs = data.metrics.vus_max.values.value;
  const requestsPerSec = data.metrics.http_reqs.values.rate;
  const totalRetries = data.metrics.retries ? data.metrics.retries.values.count : 0;

  // Generate enhanced HTML report with visualizations
  const htmlReport = generateEnhancedHtmlReport(data, rawData);
  
  console.log('\n' + '='.repeat(60));
  console.log('🎯 LOAD TEST RESULTS - SINGLE ENDPOINT');
  console.log('='.repeat(60));
  console.log(`📊 Total Requests: ${totalRequests.toLocaleString()}`);
  console.log(`✅ Success Rate: ${successRate.toFixed(2)}%`);
  console.log(`❌ Failed Requests: ${Math.round(failedRequests).toLocaleString()}`);
  console.log(`⏱️  Average Response Time: ${avgResponseTime.toFixed(2)}ms`);
  console.log(`📈 95th Percentile: ${p95ResponseTime.toFixed(2)}ms`);
  console.log(`📊 99th Percentile: ${p99ResponseTime.toFixed(2)}ms`);
  console.log(`👥 Max Virtual Users: ${maxVUs.toLocaleString()}`);
  console.log(`🚀 Requests/Second: ${requestsPerSec.toFixed(2)}`);
  console.log(`🔁 Total Retries: ${totalRetries.toLocaleString()}`);

  // Performance assessment
  console.log('\n📋 PERFORMANCE ASSESSMENT');
  console.log('-'.repeat(30));
  
  if (successRate >= 95 && p95ResponseTime < 1000) {
    console.log('🏆 EXCELLENT: Endpoint handles load very well!');
  } else if (successRate >= 90 && p95ResponseTime < 2000) {
    console.log('✅ GOOD: Endpoint handles load well');
  } else if (successRate >= 80 && p95ResponseTime < 5000) {
    console.log('⚠️  ACCEPTABLE: Endpoint handles load but needs optimization');
  } else {
    console.log('🔴 NEEDS WORK: Endpoint struggles under load');
  }

  console.log('\n' + '='.repeat(60));

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  return {
    [`loadtest-results-${timestamp}.json`]: JSON.stringify(data, null, 2),
    [`loadtest-visualizations-${timestamp}.html`]: htmlReport,
    "stdout": textSummary(data, { indent: " ", enableColors: true }),
  };
}

// =============================================
// ENHANCED HTML VISUALIZATION GENERATOR
// =============================================
function generateEnhancedHtmlReport(k6Data, rawData) {
  const successfulRequests = rawData.requests.filter(r => r.success);
  const failedRequests = rawData.requests.filter(r => !r.success);
  
  // Calculate backend distribution
  const backendCounts = {};
  rawData.backends.forEach(backend => {
    backendCounts[backend] = (backendCounts[backend] || 0) + 1;
  });
  
  // Calculate response time distribution for histogram
  const responseTimeHistogram = {
    '0-100ms': 0, '100-200ms': 0, '200-500ms': 0,
    '500-1000ms': 0, '1000-2000ms': 0, '2000-5000ms': 0, '5000ms+': 0
  };
  
  rawData.responseTimes.forEach(rt => {
    const bucket = getResponseTimeBucket(rt);
    responseTimeHistogram[bucket]++;
  });
  
  // Calculate retry distribution
  const retryDistribution = {};
  rawData.retries.forEach(retries => {
    retryDistribution[retries] = (retryDistribution[retries] || 0) + 1;
  });

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Load Test Visualizations</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .dashboard {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            max-width: 1400px;
            margin: 0 auto;
        }
        .chart-container {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .chart-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 15px;
            text-align: center;
            color: #333;
        }
        canvas {
            max-width: 100%;
        }
        .summary-stats {
            grid-column: 1 / -1;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        .stat-item {
            text-align: center;
            padding: 10px;
            border-radius: 4px;
            background: #f8f9fa;
        }
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #007bff;
        }
        .stat-label {
            font-size: 12px;
            color: #666;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="summary-stats">
        <h1>🚀 Load Test Performance Report</h1>
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-value">${k6Data.metrics.http_reqs.values.count.toLocaleString()}</div>
                <div class="stat-label">Total Requests</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${((1 - k6Data.metrics.http_req_failed.values.rate) * 100).toFixed(2)}%</div>
                <div class="stat-label">Success Rate</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${k6Data.metrics.http_req_duration.values.avg.toFixed(2)}ms</div>
                <div class="stat-label">Avg Response Time</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${k6Data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms</div>
                <div class="stat-label">95th Percentile</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${k6Data.metrics.vus_max.values.value.toLocaleString()}</div>
                <div class="stat-label">Max Virtual Users</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${k6Data.metrics.http_reqs.values.rate.toFixed(2)}</div>
                <div class="stat-label">Requests/Second</div>
            </div>
        </div>
    </div>

    <div class="dashboard">
        <!-- Chart 1: Load Distribution -->
        <div class="chart-container">
            <div class="chart-title">Load Distribution (Backend Servers)</div>
            <canvas id="loadDistributionChart"></canvas>
        </div>

        <!-- Chart 2: Response Time Distribution -->
        <div class="chart-container">
            <div class="chart-title">Response Time Distribution</div>
            <canvas id="responseTimeChart"></canvas>
        </div>

        <!-- Chart 3: Success vs Failure -->
        <div class="chart-container">
            <div class="chart-title">Success Rate</div>
            <canvas id="successRateChart"></canvas>
        </div>

        <!-- Chart 4: Retry Distribution -->
        <div class="chart-container">
            <div class="chart-title">Retry Distribution</div>
            <canvas id="retryDistributionChart"></canvas>
        </div>
    </div>

    <script>
        // Chart 1: Load Distribution (Pie Chart)
        new Chart(document.getElementById('loadDistributionChart'), {
            type: 'pie',
            data: {
                labels: ${JSON.stringify(Object.keys(backendCounts))},
                datasets: [{
                    data: ${JSON.stringify(Object.values(backendCounts))},
                    backgroundColor: [
                        '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
                        '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF'
                    ]
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'right',
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.raw || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = Math.round((value / total) * 100);
                                return \`\${label}: \${value} (\${percentage}%)\`;
                            }
                        }
                    }
                }
            }
        });

        // Chart 2: Response Time Distribution (Histogram)
        const responseTimeData = ${JSON.stringify(responseTimeHistogram)};
        new Chart(document.getElementById('responseTimeChart'), {
            type: 'bar',
            data: {
                labels: Object.keys(responseTimeData),
                datasets: [{
                    label: 'Number of Requests',
                    data: Object.values(responseTimeData),
                    backgroundColor: 'rgba(54, 162, 235, 0.8)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Requests'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Response Time Buckets'
                        }
                    }
                }
            }
        });

        // Chart 3: Success vs Failure
        const successCount = ${successfulRequests.length};
        const failureCount = ${failedRequests.length};
        new Chart(document.getElementById('successRateChart'), {
            type: 'bar',
            data: {
                labels: ['Success', 'Failure'],
                datasets: [{
                    label: 'Number of Requests',
                    data: [successCount, failureCount],
                    backgroundColor: ['#4CAF50', '#F44336'],
                    borderColor: ['#45a049', '#d32f2f'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Requests'
                        }
                    }
                }
            }
        });

        // Chart 4: Retry Distribution
        const retryData = ${JSON.stringify(retryDistribution)};
        new Chart(document.getElementById('retryDistributionChart'), {
            type: 'bar',
            data: {
                labels: Object.keys(retryData).map(r => \`\${r} retries\`),
                datasets: [{
                    label: 'Number of Requests',
                    data: Object.values(retryData),
                    backgroundColor: '#FF9800',
                    borderColor: '#F57C00',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Requests'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Number of Retries'
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>`;
}

// =============================================
// SETUP AND TEARDOWN
// =============================================
export function setup() {
  console.log('🚀 Starting Load Test');
  console.log(`🎯 Target: ${TEST_CONFIG.ENDPOINT}`);
  console.log(`⏰ Estimated Duration: 23 minutes`);
  console.log(`👥 Max Users: 10,000`);
  console.log('='.repeat(50));
  
  return {
    startTime: new Date().toISOString(),
    targetEndpoint: TEST_CONFIG.ENDPOINT
  };
}

export function teardown(data) {
  console.log('\n' + '='.repeat(50));
  console.log('🏁 Load Test Completed');
  console.log(`🕒 Start Time: ${data.startTime}`);
  console.log(`🕒 End Time: ${new Date().toISOString()}`);
  console.log('='.repeat(50));
}
