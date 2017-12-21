function pluginMongoose (schema) {

  function getSearchParams (rawParams) {

    var model = this;

    var convertToBoolean = function (str) {
      if (str.toLowerCase() === "true" ||
          str.toLowerCase() === "t" ||
          str.toLowerCase() === "yes" ||
          str.toLowerCase() === "y" ||
          str === "1"){
        return true;
      } else {
        return false;
      }
    };

    var searchParams = {};

    var parseSchemaForKey = function (schema, keyPrefix, lcKey, val, operator) {
        // console.log(schema, keyPrefix, lcKey, val, operator);
      var paramType = false;

      var addSearchParam = function (val) {
        var key = keyPrefix + lcKey;

        if (typeof searchParams[key] !== 'undefined') {
        for (i in val) {
            searchParams[key][i] = val[i];
        }
        } else {
            searchParams[key] = val;
        }
      };
      if (matches = lcKey.match(/(.+)\.(.+)/)) {
        // parse subschema
        if (schema.paths[matches[1]].constructor.name === "DocumentArray" ||
            schema.paths[matches[1]].constructor.name === "Mixed") {
          parseSchemaForKey(schema.paths[matches[1]].schema, matches[1] + ".", matches[2], val, operator)
        }

      } else if (typeof schema === "undefined") {
        paramType = "String";

      } else if (typeof schema.paths[lcKey] === "undefined"){
        // nada, not found

      } else if (operator === "near") {
        paramType = "Near";
      } else if (schema.paths[lcKey].constructor.name === "SchemaBoolean") {
        paramType = "Boolean";
      } else if (schema.paths[lcKey].constructor.name === "SchemaString") {
        paramType = "String";
      } else if (schema.paths[lcKey].constructor.name === "SchemaNumber") {
        paramType = "Number";
      } else if (schema.paths[lcKey].constructor.name === "ObjectId") {
        paramType = "ObjectId";
      }
      if (paramType === "Boolean") {
        addSearchParam(convertToBoolean(val));
      } else if (paramType === "Number") {
        if (val.match(/([0-9]+,?)/) && val.match(',')) {
          if (operator === "all") {
            addSearchParam({$all: val.split(',')});
          } else if (operator === "nin") {
            addSearchParam({$nin: val.split(',')});
          } else if (operator === "mod") {
            addSearchParam({$mod: [val.split(',')[0], val.split(',')[1]]});
          } else {
            addSearchParam({$in: val.split(',')});
          }
        } else if (val.match(/([0-9]+)/)) {
          if (operator === "gt" ||
              operator === "gte" ||
              operator === "lt" ||
              operator === "lte" ||
              operator === "ne") {
            var newParam = {};
            newParam["$" + operator] = val;
            addSearchParam(newParam);
          } else {
            addSearchParam(parseInt(val));
          }
        }
      } else if (paramType === "String") {
        if (val.match(',')) {
          var options = val.split(',').map(function(str){
            return new RegExp(str, 'i');
          });

          if (operator === "all") {
            addSearchParam({$all: options});
          } else if (operator === "nin") {
            addSearchParam({$nin: options});
          } else {
            addSearchParam({$in: options});
          }
        } else if (val.match(/([0-9]+)/)) {
          if (operator === "gt" ||
              operator === "gte" ||
              operator === "lt" ||
              operator === "lte") {
            var newParam = {};
            newParam["$" + operator] = val;
            addSearchParam(newParam);
          } else {
            addSearchParam(val);
          }
        } else if (operator === "ne" || operator === "not") {
          var neregex = new RegExp(val,"i");
          addSearchParam({'$not': neregex});
        } else if (operator === "exact") {
          addSearchParam(val);
        } else if (val === 'null'){
            addSearchParam(null);    
        }else {
            addSearchParam({$regex: val, $options: "-i"});
        }
      } else if (paramType === "Near") {
        // divide by 69 to convert miles to degrees
        var latlng = val.split(',');
        var distObj = {$near: [parseFloat(latlng[0]), parseFloat(latlng[1])]};
        if (typeof latlng[2] !== 'undefined') {
          distObj.$maxDistance = parseFloat(latlng[2]) / 69;
        }
        addSearchParam(distObj);
      } else if (paramType === "ObjectId") {
        addSearchParam(val);
      }

    };

    var parseParam = function (key, val) {
        var operator = val.match(/\{(.*)\}/)
        if (operator) operator = operator[1];
        parseSchemaForKey(model.schema, "", key, val.replace(/\{(.*)\}/, ''), operator);
    }

    // Construct searchParams
    for (var key in rawParams) {
      if (!rawParams[key]) continue;
      var maisDeUmTermo = rawParams[key].match(/\{\w+\}(.[^\{\}]*)/g);

      if (maisDeUmTermo === null) {
        parseParam(key, rawParams[key]);
      } else {
        for (var i = 0, len = maisDeUmTermo.length; i < len; ++i) {
          parseParam(key, maisDeUmTermo[i]);
        }
      }
    }

    return searchParams;
  };

  schema.statics.paginate = function(query, options, callback){
      query = query || {};
      options = Object.assign({}, options);
      let select = options.select;
      let sort = options.sort;
      let populate = options.populate;
      let lean = options.lean === false ? false : true;
      let limit = options.limit ? options.limit : 10;
      let page, offset, skip, promises;
      if (options.offset) {
        offset = options.offset;
        skip = offset;
      } else if (options.page) {
        page = options.page;
        skip = (page - 1) * limit;
      } else {
        page = 1;
        offset = 0;
        skip = offset;
      }
      if (limit) {
        let docsQuery = this.find(query)
          .select(select)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(lean);
        if (populate) {
          [].concat(populate).forEach((item) => {
            docsQuery.populate(item);
          });
        }
        promises = {
          docs: docsQuery.exec(),
          count: this.count(query).exec()
        };
        if (lean && leanWithId) {
          promises.docs = promises.docs.then((docs) => {
            docs.forEach((doc) => {
              doc.id = String(doc._id);
            });
            return docs;
          });
        }
      }
      promises = Object.keys(promises).map((x) => promises[x]);
      return Promise.all(promises).then((data) => {
        // Por algum motivo isso funcionou algum dia, mesmo ele transformando em array...
        // TODO: Melhorar a busca paralele
        let result = {
          docs: data[0],
          total: data[1],
          limit: limit
        };
        if (offset !== undefined) {
          result.offset = offset;
        }
        if (page !== undefined) {
          result.page = page;
          result.pages = Math.ceil(data.count / limit) || 1;
        }
        if (typeof callback === 'function') {
          return callback(null, result);
        }
        let promise = new Promise();
        promise.resolve(result);
        return promise;
      });
  }

  /**
   * Função que efetivamente será chamada pelo serviço/router
   */
  schema.statics.lucisApiQuery = function(callback){
    // TODO: O mongoose-paginate não trata erros, tem que adicionar isso e tratar aqui também
    return (req, res) => {
      const lucisApiData = getDataFromReq(req, res);
      const parsedParams = getSearchParams(req.query);
      this.paginate(parsedParams, lucisApiData, (data)=>{
        if (callback){
          return callback(req, res, data);
        }
        return res.json(data);
      });
    };
  };
};

/**
 * Maps the sent params regarding pagination to its own object and removes them from the request params
 * 
 * @param {*} req 
 * @param {*} res 
 * @param {*} next 
 */
function getDataFromReq (req, res) {
  // Data regarding pagination
  req.query.page = (typeof req.query.page === 'string') ? parseInt(req.query.page, 10) || 1 : 1;

  req.query.limit = (typeof req.query.limit === 'string') ? parseInt(req.query.limit, 10) || 0 : 10;

  if (req.query.limit > 50)
  req.query.limit = 50;

  if (req.query.page < 1)
  req.query.page = 1;

  if (req.query.limit < 0)
  req.query.limit = 0;

  req.skip = req.offset = (req.query.page * req.query.limit) - req.query.limit;

  const lucisApiData = {};
  lucisApiData.skip = req.skip;
  lucisApiData.page = req.query.page;
  lucisApiData.limit = req.query.limit

  delete req.query.page;
  delete req.query.limit;

  // Data regarding selection and paginate
  let { select, paginate } = req.query;
  select =  (typeof select === 'string') ? select.replace(',', ' ') : null;
  paginate =  (typeof paginate === 'string') ? paginate.replace(',', ' ') : null;

  lucisApiData.select = req.query.select;
  lucisApiData.paginate = req.query.paginate
  delete req.query.select;
  delete req.query.paginate;

  return lucisApiData;
};

// TODO: Não deve ser necessário
// function montaEntidadePaginacao(resposta){
//   return {
//           totalDeEntidades: resposta.total,
//           entidades: resposta.docs,
//           pagina: resposta.page,
//           resultadosPorPagina: resposta.limit,
//           totalDePaginas: resposta.pages
//       }
// };

// TODO: Não deve ser necessário
// function montaConfigPaginacao(paginacao, campos, populate){
//   return { 
//       page: paginacao.pagina, 
//       limit: paginacao.resultadosPorPagina, 
//       lean: true,
//       select: campos,
//       populate: populate
//   };
// };

const biblioteca = {pluginMongoose};

module.exports = exports = biblioteca;