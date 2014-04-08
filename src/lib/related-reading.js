// related-reading.js

"use strict"
var request = require('superagent')
    , xml2js = require('xml2js')
    , maxArticles = 10
    , initQuery
    , finalResult = {
        pubmed: null
        , plos: null
      }
    , sendFinalResult
    , noCallback
    , finalCallback
    , pubmed
    , plos
    , response

// Start all the queries
initQuery = function (options, callback) {
  
  options.query = ['cardiac']
  
  if (!options || !options.query) { // What the hell are we supposed to do?!
    return
  }
  
  // Final callback function
  finalCallback = callback ? callback : noCallback
  
  // Has a new limit been set?
  options.articleCount = options.articleCount || maxArticles
  
  // Change the global value for this
  maxArticles = options.articleCount
  
  pubmed.search(options.query)
  
  plos.search(options.query, options.plosKey)
  
}

exports.query = function (options, callback) {
  try {
    initQuery(options, callback)
  } catch(e) {
    console.log('catch', e)
  }
}


sendFinalResult = function () {
  var s
      , send
  
  for (s in finalResult) {
    if (finalResult[s] === null) { return }
  }
  
  return finalCallback(false, finalResult)
  
}

noCallback = function (err, send) {
  console.log(err, JSON.stringify(send))
}

pubmed = {
  options: {
    baseUrl: 'http://eutils.ncbi.nlm.nih.gov/entrez/eutils/' // The base of all API queries to Pubmed
    , links: {
        base: 'http://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?dbfrom=pubmed&id='
        , end: '&cmd=prlinks&retmode=ref'
      }
    , options: {
        db: 'pubmed' // Pubmed database key, this is always the same
        , usehistory: 'y' // Use history - saves the results on the server under the key & web params
      }
  }
  
  // Abort
  , fail: function (message) {
      
      finalResult.pubmed = {
        error: [message]
        , reason: message
      }
      
      sendFinalResult()
  }
  
  // Fetch more information about the results of the search
  , fetch: function () {
    // We don't have to resubmit our query because we're using the 
    // usehistory flag in our original search, this means that
    // Pubmed remembers that we made the search
    request.get(pubmed.options.baseUrl + 'efetch.fcgi')
      .query(pubmed.options.options)
      .query({ rettype : 'abstract' })
      .query({ retmode : 'xml' })
      .query({ retmax: maxArticles }) // Limit the results
      .end(pubmed.parseFetch)
  }
  
  
  // Parse the results of the fetch
  , parseFetch: function (err, result) {
    var parser = new xml2js.Parser({ async: true , explicitArray: false })
    
    // There was an error
    if (err) {
      // Abort
      return pubmed.fail('Failed to fetch results')
    }
    
    // Parse the results
    parser.parseString(result.text, function (err, parsed) {
      var send = []
          , i
      
      // There was an error
      if (err) {
        // Abort
        return pubmed.fail('Failed to parse fetch results')
      }
      
      if (parsed && parsed.PubmedArticleSet && parsed.PubmedArticleSet.PubmedArticle) {
        send = parsed.PubmedArticleSet.PubmedArticle
      }
      
      send = pubmed.reformatFetchResults(send)
      
      finalResult.pubmed = {
        status: 'okay'
        , response: {
          docs: send
        }
      }
      
      sendFinalResult()
    })
  }
  
  
  // Reformat the results returned from the fetch
  , reformatFetchResults: function (results) {
    var i
    // Add the link in. Either we have to do another/a bunch more requests, or we just make our
    //  link a request through the Pubmed linking service - it's no problem as it's a proper
    //  redirect, so the annotations will still have the end-result url on them
    for (i = 0; i < results.length; i++) {
      results[i].MedlineCitation.link = [this.options.links.base, results[i].MedlineCitation.PMID._, this.options.links.end].join('')
      
      results[i].MedlineCitation.date = Date.parse([
        results[i].MedlineCitation.DateCreated.Year
        , results[i].MedlineCitation.DateCreated.Month
        , results[i].MedlineCitation.DateCreated.Day
      ].join('/')) // Add a date that's easy to implement
      
      results[i].title = results[i].MedlineCitation.Article.ArticleTitle
      if (results[i].MedlineCitation.Article.Abstract) {
        results[i].abstract = (results[i].MedlineCitation.Article.Abstract.AbstractText || '').toString()
      } else {
        results[i].abstract = ''
      }
      
    }
    
    return results
    
  }
  
  
  // Search pubmed
  , search: function (queryList) {
    // Send a request to Pubmed's horrible search things
    // http://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESummary
    
    // This one is to the search service -- find publications that match this
    request.get(pubmed.options.baseUrl + 'esearch.fcgi')
      .query(pubmed.options.options)            // Search options
      .query({ term: queryList.join(' ') })     // Search terms
      .query({ retmax: maxArticles })           // Limit the number of results
      .end(pubmed.searchParse)                  // Parse the search
  }
  
  
  // Parse the Pubmed search results
  , searchParse: function (err, result) {
    var parser = new xml2js.Parser({ async: true })
    
    // There was an error
    if (err) {
      // Abort
      return pubmed.fail('Failed to find results')
    }

    
    // Parse the results
    parser.parseString(result.text, function (err, parsed) {
      
      // There was an error
      if (err) {
        // Abort
        return pubmed.fail('Failed to parse search results')
      }
      
      // The results haven't come back as expected
      if (!parsed.eSearchResult.QueryKey || !parsed.eSearchResult.QueryKey[0]
          || parsed.eSearchResult.WebEnv || !parsed.eSearchResult.WebEnv[0]) {
        
        // Abort
        return pubmed.fail('Failed to parse search results')
        
      }
      
      pubmed.options.options.query_key = parsed.eSearchResult.QueryKey[0] // Set the key
      pubmed.options.options.WebEnv = parsed.eSearchResult.WebEnv[0] // Set the web environment
      
      // Fetch more information about the results
      pubmed.fetch()
      
    })
  }
  
}


plos = {
  
  baseUrl: 'http://api.plos.org/search'
  
  , search: function (queryList, plosKey) {
    if (!plosKey) {
      finalResult.plos = []
      return sendFinalResult()
    }
    
    // 
    // Search Fields
    // 
    // http://api.plos.org/solr/search-fields/
    // 
    // EXAMPLE
    // 
    // http://api.plos.org/search?q=subject:"oncology"&api_key=oYsULLvgoh97rWqCSv5W&wt=json&rows=30&fl=id,title_display,counter_total_month,author_display,abstract,journal,article_type,publication_date&fq=!article_type_facet:"Issue Image" AND doc_type:full
    
    request.get(plos.baseUrl)
      .query({ api_key: plosKey })
      .query({ q: 'title:' + queryList.join(' ') })
      .query({ fl: 'id,title,title_display,introduction,reference,subject,publisher,counter_total_month,author_display,abstract,journal,article_type,publication_date' })
      .query({ fq: '!article_type_facet:"Issue Image" AND doc_type:full' })
      .query({ sort: 'publication_date desc' })
      .query({ start: '0' })
      .query({ rows: maxArticles })
      .query({ wt: 'json' })
      .timeout(600000) // The request has at most a minute
      .end(plos.searchParse)
    
  }
  
  
  , searchParse: function (err, result) {
      var data
      
      if (err) {
        console.log(err)
        data = {
          error: [err.message]
          , reason: err.message
        }
      } else {
        data = JSON.parse(result.text)
        data.status = 'okay'
      }
      
      finalResult.plos = data
      sendFinalResult()
      
    }
  
}